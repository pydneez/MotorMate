import { apiBaseUrl } from "./api";

describe("apiBaseUrl", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("defaults to the local backend", () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.API_INTERNAL_URL;
    expect(apiBaseUrl(false)).toBe("http://localhost:8080/v1");
    expect(apiBaseUrl(true)).toBe("http://localhost:8080/v1");
  });

  it("on AWS, the browser uses the relative path and the server uses the load balancer", () => {
    process.env.NEXT_PUBLIC_API_URL = "/v1";
    process.env.API_INTERNAL_URL = "http://motormate-alb.example/v1";
    expect(apiBaseUrl(false)).toBe("/v1");
    expect(apiBaseUrl(true)).toBe("http://motormate-alb.example/v1");
  });

  it("refuses a relative URL on the server", () => {
    process.env.NEXT_PUBLIC_API_URL = "/v1";
    delete process.env.API_INTERNAL_URL;
    expect(() => apiBaseUrl(true)).toThrow("API_INTERNAL_URL");
  });
});
