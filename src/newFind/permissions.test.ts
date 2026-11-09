import { ensurePermission, type PermissionAsker } from "./permissions";

/** Stands in for a library's permission functions: what it says before and after asking. */
function asker(before: unknown, after: unknown = before) {
  const calls: string[] = [];
  const permission: PermissionAsker = {
    get: async () => {
      calls.push("get");
      return before;
    },
    request: async () => {
      calls.push("request");
      return after;
    },
  };
  return { permission, calls };
}

const answer = (status: string, canAskAgain = true) => ({
  status,
  granted: status === "granted",
  canAskAgain,
  expires: "never",
});

describe("ensurePermission", () => {
  it("does not ask when the permission is granted", async () => {
    const { permission, calls } = asker(answer("granted"));
    await expect(ensurePermission(permission, { askAgainWhenDenied: true })).resolves.toBe(
      "granted",
    );
    expect(calls).toEqual(["get"]);
  });

  it("asks the first time, and gives what the user chose", async () => {
    const { permission, calls } = asker(answer("undetermined"), answer("granted"));
    await expect(ensurePermission(permission, { askAgainWhenDenied: false })).resolves.toBe(
      "granted",
    );
    expect(calls).toEqual(["get", "request"]);
  });

  it("says denied when the user says no to the first ask but may be asked again", async () => {
    const { permission } = asker(answer("undetermined"), answer("denied", true));
    await expect(ensurePermission(permission, { askAgainWhenDenied: false })).resolves.toBe(
      "denied",
    );
  });

  it("says blocked when the user says no and the phone lets the app ask no more", async () => {
    const { permission } = asker(answer("undetermined"), answer("denied", false));
    await expect(ensurePermission(permission, { askAgainWhenDenied: true })).resolves.toBe(
      "blocked",
    );
  });

  it("does not ask again after a no when told not to", async () => {
    const { permission, calls } = asker(answer("denied", true));
    await expect(ensurePermission(permission, { askAgainWhenDenied: false })).resolves.toBe(
      "denied",
    );
    expect(calls).toEqual(["get"]);
  });

  it("asks again after a no when told to, while the phone allows it", async () => {
    const { permission, calls } = asker(answer("denied", true), answer("granted"));
    await expect(ensurePermission(permission, { askAgainWhenDenied: true })).resolves.toBe(
      "granted",
    );
    expect(calls).toEqual(["get", "request"]);
  });

  it("does not ask when the phone lets the app ask no more", async () => {
    const { permission, calls } = asker(answer("denied", false));
    await expect(ensurePermission(permission, { askAgainWhenDenied: true })).resolves.toBe(
      "blocked",
    );
    expect(calls).toEqual(["get"]);
  });

  it.each<[string, unknown]>([
    ["nothing", null],
    ["an unknown status", answer("maybe")],
    ["a status that is not text", { status: 1, canAskAgain: true }],
    ["a granted flag only", { granted: true }],
  ])("treats %s as not granted, without asking", async (_, before) => {
    const { permission, calls } = asker(before);
    await expect(ensurePermission(permission, { askAgainWhenDenied: true })).resolves.toBe(
      "denied",
    );
    expect(calls).toEqual(["get"]);
  });

  it("treats an answer to the ask that it cannot read as not granted", async () => {
    const { permission } = asker(answer("undetermined"), { status: "granted" });
    await expect(ensurePermission(permission, { askAgainWhenDenied: true })).resolves.toBe(
      "denied",
    );
  });

  it("treats a permission that cannot be read or asked as not granted", async () => {
    const permission: PermissionAsker = {
      get: async () => {
        throw new Error("no activity");
      },
      request: async () => answer("granted"),
    };
    await expect(ensurePermission(permission, { askAgainWhenDenied: true })).resolves.toBe(
      "denied",
    );
  });
});
