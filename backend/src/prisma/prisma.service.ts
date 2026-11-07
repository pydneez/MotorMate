import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { shopScope } from "../common/tenancy/shop-scope.extension";
import { pgConfig } from "./pg-config";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg(pgConfig()) });
    // Every PrismaService Nest hands out is the shop-scoped client (common/tenancy). Query
    // extensions don't change the client's types, so it's still a PrismaService to callers;
    // Nest calls the lifecycle hooks on this returned object, so they're carried over.
    return Object.assign(this.$extends(shopScope), {
      onModuleInit: () => this.$connect(),
      onModuleDestroy: () => this.$disconnect(),
    }) as unknown as PrismaService;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
