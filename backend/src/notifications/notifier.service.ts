import { Injectable, Logger } from "@nestjs/common";
import {
  GetSubscriptionAttributesCommand,
  InvalidParameterException,
  ListSubscriptionsByTopicCommand,
  NotFoundException as SnsNotFound,
  PublishCommand,
  SetSubscriptionAttributesCommand,
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
} from "@aws-sdk/client-sns";
import type { NotificationType, NotifyStatus } from "@motormate/types";
import { PrismaService } from "../prisma/prisma.service";

export type NotifyTarget = { id: string; email: string | null; notifyConfirmed: boolean };

export type Notification = {
  type: NotificationType;
  customer: NotifyTarget;
  subject: string;
  body: string;
  /** Service reminders: one log row per recommendation, so each one's reminders can be counted. */
  recommendationIds?: string[];
  appointmentId?: string;
  /**
   * Record it as "not sent" when it can't go out. For one-off emails (appointments), so staff
   * see it was missed; service reminders are simply retried by the next morning's run.
   */
  recordSkipped?: boolean;
};

export type SendResult = "sent" | "failed" | "noEmail" | "notConfirmed";

const SUBSCRIBE_FIELDS = { id: true, email: true, notifySubscriptionArn: true, notifyEmail: true, notifyConfirmed: true } as const;

/** Subscriptions and messages are matched on the lower-cased address. */
const emailKey = (email: string) => email.trim().toLowerCase();

/**
 * Customer emails. SES is blocked in Learner Lab, so on AWS they go through an SNS topic
 * (NOTIFY_TOPIC_ARN): every email address gets one subscription, filtered on that address,
 * which its owner confirms once from AWS's email; a message tagged with the address reaches
 * only that subscription. Keyed on the address (not the customer id), so a confirmed address
 * stays confirmed when the database is rebuilt or the person signs up again.
 * Without a topic (local development) emails are written to the log instead.
 * Every email sent or failed — and appointment emails that couldn't be sent — is recorded
 * in NotificationLog.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger("Notifier");
  private readonly topicArn = process.env.NOTIFY_TOPIC_ARN || null;
  private snsClient: SNSClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  get mode(): "sns" | "log" {
    return this.topicArn ? "sns" : "log";
  }

  notifyStatus(customer: { email: string | null; notifyConfirmed: boolean }): NotifyStatus {
    if (!customer.email) return "none";
    if (this.mode === "log") return "local";
    return customer.notifyConfirmed ? "confirmed" : "pending";
  }

  /**
   * Brings one customer's subscription in line with their email: subscribes a new or
   * changed address, drops it when the email is gone. A new address gets AWS's confirmation
   * email; an address that's already confirmed on the topic is reused as it is.
   * Best effort — callers never fail because of it; the daily job catches anything missed.
   * Returns true if a subscription was made or reused.
   */
  async syncCustomer(customerId: string): Promise<boolean> {
    if (!this.topicArn) return false;
    try {
      const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: SUBSCRIBE_FIELDS });
      if (!customer || customer.email === customer.notifyEmail) return false;

      if (customer.notifySubscriptionArn) await this.unsubscribe(customer.notifySubscriptionArn);
      if (!customer.email) {
        await this.prisma.customer.update({
          where: { id: customerId },
          data: { notifySubscriptionArn: null, notifyEmail: null, notifyConfirmed: false },
        });
        return false;
      }
      const arn = await this.subscribe(customer.email);
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { notifySubscriptionArn: arn, notifyEmail: customer.email, notifyConfirmed: false },
      });
      // Already confirmed (an address seen before)? Then it's usable straight away.
      if (arn) await this.refreshConfirmation(customerId, arn);
      return true;
    } catch (error) {
      this.logger.warn(`Couldn't sync the email subscription of customer ${customerId}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * The daily catch-up: subscribes customers whose email has no (or an outdated)
   * subscription, and re-checks every subscription — confirmed since yesterday, or
   * unsubscribed by the customer (AWS's unsubscribe link).
   * Returns how many subscriptions were made.
   */
  async syncAll(): Promise<number> {
    if (!this.topicArn) return 0;
    const customers = await this.prisma.customer.findMany({
      where: { OR: [{ email: { not: null } }, { notifySubscriptionArn: { not: null } }] },
      select: SUBSCRIBE_FIELDS,
    });
    let subscribed = 0;
    for (const customer of customers) {
      if (customer.email !== customer.notifyEmail) {
        if (await this.syncCustomer(customer.id)) subscribed++;
      } else if (customer.notifySubscriptionArn) {
        await this.refreshConfirmation(customer.id, customer.notifySubscriptionArn);
      }
    }
    return subscribed;
  }

  /**
   * Sends one email and records it. A customer without an email, or (on AWS) one who hasn't
   * confirmed their subscription, is skipped — recorded as "not sent" only when
   * `recordSkipped` is set; the caller decides what else that means.
   */
  async send(notification: Notification): Promise<SendResult> {
    const { customer } = notification;
    const skipped: SendResult | null = !customer.email ? "noEmail" : this.mode === "sns" && !customer.notifyConfirmed ? "notConfirmed" : null;
    if (skipped) {
      if (notification.recordSkipped) {
        await this.record(notification, {
          status: "SKIPPED",
          error: skipped === "noEmail" ? "No email address" : "Email not confirmed (AWS subscription)",
        });
      }
      return skipped;
    }

    let error: string | null = null;
    try {
      if (this.topicArn) {
        await this.sns().send(
          new PublishCommand({
            TopicArn: this.topicArn,
            Subject: snsSubject(notification.subject),
            Message: notification.body,
            MessageAttributes: { email: { DataType: "String", StringValue: emailKey(customer.email!) } },
          }),
        );
      } else {
        this.logger.log(`Email to ${customer.email} — ${notification.subject}\n${notification.body}`);
      }
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
      this.logger.warn(`Couldn't send "${notification.subject}" to customer ${customer.id}: ${error}`);
    }

    await this.record(notification, { status: error ? "FAILED" : "SENT", error });
    return error ? "failed" : "sent";
  }

  private async record(notification: Notification, outcome: { status: "SENT" | "FAILED" | "SKIPPED"; error: string | null }) {
    const now = new Date();
    const base = {
      type: notification.type,
      recipientEmail: notification.customer.email,
      status: outcome.status,
      error: outcome.error,
      subject: notification.subject,
      customerId: notification.customer.id,
      appointmentId: notification.appointmentId ?? null,
      sentAt: outcome.status === "SENT" ? now : null,
      // The same instant on every row of one email, so the history can show it once.
      createdAt: now,
    };
    const ids = notification.recommendationIds?.length ? notification.recommendationIds : [null];
    await this.prisma.notificationLog.createMany({ data: ids.map((recommendationId) => ({ ...base, recommendationId })) });
  }

  /**
   * Subscribes an address, filtered on itself. SNS hands back the existing subscription when
   * the address is already on the topic with the same filter; one made before the filter
   * changed (it used to be the customer id) is moved over to the new filter.
   * Returns the subscription ARN, or null when SNS has none to give (still pending).
   */
  private async subscribe(email: string): Promise<string | null> {
    const filterPolicy = JSON.stringify({ email: [emailKey(email)] });
    try {
      const { SubscriptionArn } = await this.sns().send(
        new SubscribeCommand({
          TopicArn: this.topicArn!,
          Protocol: "email",
          Endpoint: email,
          ReturnSubscriptionArn: true,
          Attributes: { FilterPolicy: filterPolicy, FilterPolicyScope: "MessageAttributes" },
        }),
      );
      return SubscriptionArn ?? null;
    } catch (error) {
      if (!(error instanceof InvalidParameterException) || !/already exists/i.test(error.message)) throw error;
      const { Subscriptions = [] } = await this.sns().send(new ListSubscriptionsByTopicCommand({ TopicArn: this.topicArn! }));
      const existing = Subscriptions.find((s) => s.Endpoint && emailKey(s.Endpoint) === emailKey(email) && s.SubscriptionArn?.startsWith("arn:"));
      if (!existing?.SubscriptionArn) return null;
      await this.sns().send(
        new SetSubscriptionAttributesCommand({ SubscriptionArn: existing.SubscriptionArn, AttributeName: "FilterPolicy", AttributeValue: filterPolicy }),
      );
      return existing.SubscriptionArn;
    }
  }

  private async refreshConfirmation(customerId: string, arn: string): Promise<void> {
    try {
      const { Attributes } = await this.sns().send(new GetSubscriptionAttributesCommand({ SubscriptionArn: arn }));
      const confirmed = Attributes?.PendingConfirmation === "false";
      await this.prisma.customer.update({ where: { id: customerId }, data: { notifyConfirmed: confirmed } });
    } catch (error) {
      // Gone: the customer unsubscribed, or an unconfirmed subscription expired. Staff then
      // see "Email not confirmed"; a changed email subscribes again.
      if (error instanceof SnsNotFound) {
        await this.prisma.customer.update({ where: { id: customerId }, data: { notifySubscriptionArn: null, notifyConfirmed: false } });
      } else {
        this.logger.warn(`Couldn't check the subscription of customer ${customerId}: ${(error as Error).message}`);
      }
    }
  }

  private async unsubscribe(arn: string): Promise<void> {
    try {
      await this.sns().send(new UnsubscribeCommand({ SubscriptionArn: arn }));
    } catch {
      // A pending or already removed subscription can't be unsubscribed — nothing to do.
    }
  }

  /** Created on first use; on ECS it picks up the task role's credentials and region. */
  private sns(): SNSClient {
    this.snsClient ??= new SNSClient({});
    return this.snsClient;
  }
}

/** SNS email subjects must be ASCII, single-line and under 100 characters. */
export function snsSubject(subject: string): string {
  const ascii = subject.replace(/\s+/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/ {2,}/g, " ").trim();
  return ascii.length > 99 ? `${ascii.slice(0, 96)}...` : ascii || "MotorMate";
}
