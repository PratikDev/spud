import { describe, expect, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";

import { canManageTask, isSameOwner, isServerAdmin, isTeamLead } from "@/discord/authorization";
import type { Project } from "@/types";

function fakeInteraction(userId: string, isAdmin: boolean): ChatInputCommandInteraction {
  return {
    user: { id: userId },
    memberPermissions: { has: () => isAdmin },
  } as unknown as ChatInputCommandInteraction;
}

function fakeProject(teamLead: string): Project {
  return { team_lead: teamLead } as Project;
}

describe("isSameOwner", () => {
  test("true when ids match", () => {
    expect(isSameOwner("u1", "u1")).toBe(true);
  });

  test("false when ids differ", () => {
    expect(isSameOwner("u1", "u2")).toBe(false);
  });

  test("false when there's no owner to match against", () => {
    expect(isSameOwner("u1", null)).toBe(false);
  });
});

describe("canManageTask", () => {
  test("the task's owner can manage it", () => {
    expect(canManageTask(fakeInteraction("u1", false), "u1")).toBe(true);
  });

  test("a non-owner, non-admin cannot manage it", () => {
    expect(canManageTask(fakeInteraction("u1", false), "u2")).toBe(false);
  });

  test("a server admin can manage it even without owning it", () => {
    expect(canManageTask(fakeInteraction("u1", true), "u2")).toBe(true);
  });

  test("an unclaimed task (null owner) is deniable by a non-admin", () => {
    expect(canManageTask(fakeInteraction("u1", false), null)).toBe(false);
  });
});

describe("isServerAdmin", () => {
  test("true when the member has Administrator", () => {
    expect(isServerAdmin(fakeInteraction("u1", true))).toBe(true);
  });

  test("false when the member lacks Administrator", () => {
    expect(isServerAdmin(fakeInteraction("u1", false))).toBe(false);
  });

  test("false when memberPermissions is unavailable", () => {
    const interaction = { user: { id: "u1" }, memberPermissions: null } as unknown as ChatInputCommandInteraction;
    expect(isServerAdmin(interaction)).toBe(false);
  });
});

describe("isTeamLead", () => {
  test("true for the project's team lead", () => {
    expect(isTeamLead(fakeInteraction("lead1", false), fakeProject("lead1"))).toBe(true);
  });

  test("false for anyone else, even a server admin — no admin override", () => {
    expect(isTeamLead(fakeInteraction("admin1", true), fakeProject("lead1"))).toBe(false);
  });
});
