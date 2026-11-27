import { test } from "node:test";
import assert from "node:assert/strict";
import { sendNow, sendPicked, type SenderAgent } from "../client/pending-send.ts";

function fakeAgent(status: string | null, opts: { failRefresh?: boolean; failSend?: boolean; pending?: number } = {}) {
  const sent: { text: string; options?: unknown }[] = [];
  let refreshes = 0;
  const agent: SenderAgent & { sent: typeof sent; refreshes: () => number } = {
    status: null,
    sent,
    refreshes: () => refreshes,
    async refresh() {
      refreshes += 1;
      if (opts.failRefresh) throw new Error("offline");
      agent.status = status;
      agent.pendingPermissions = opts.pending ?? 0;
    },
    async send(text, options) {
      if (opts.failSend) throw new Error("send failed");
      sent.push(options === undefined ? { text } : { text, options });
    },
  };
  return agent;
}

test("running tab gets a steered send", async () => {
  const agent = fakeAgent("running");
  await sendNow(agent, "hi");
  assert.deepEqual(agent.sent, [{ text: "hi", options: { activeTurnBehavior: "steer" } }]);
  assert.equal(agent.refreshes(), 1);
});

test("running tab with a pending question gets an interrupting send", async () => {
  const agent = fakeAgent("running", { pending: 1 });
  await sendNow(agent, "hi");
  assert.deepEqual(agent.sent, [{ text: "hi", options: { activeTurnBehavior: "interrupt" } }]);
});

test("idle tab gets a plain send with no options", async () => {
  const agent = fakeAgent("idle");
  await sendNow(agent, "hi");
  assert.deepEqual(agent.sent, [{ text: "hi" }]);
});

test("unknown status gets a plain send", async () => {
  const agent = fakeAgent(null);
  await sendNow(agent, "hi");
  assert.deepEqual(agent.sent, [{ text: "hi" }]);
});

test("a failed refresh sends nothing and rejects", async () => {
  const agent = fakeAgent("idle", { failRefresh: true });
  await assert.rejects(sendNow(agent, "hi"), /offline/);
  assert.deepEqual(agent.sent, []);
});

test("sendPicked leaves the pick alone when the send goes out", async () => {
  let unpicked = 0;
  await sendPicked(fakeAgent("running"), "hi", async () => { unpicked += 1; });
  assert.equal(unpicked, 0);
});

test("sendPicked clears the pick when the send throws, and keeps the send's error", async () => {
  let unpicked = 0;
  await assert.rejects(sendPicked(fakeAgent("idle", { failSend: true }), "hi", async () => { unpicked += 1; }), /send failed/);
  assert.equal(unpicked, 1);
});

test("sendPicked clears the pick when the refresh fails", async () => {
  let unpicked = 0;
  await assert.rejects(sendPicked(fakeAgent("idle", { failRefresh: true }), "hi", async () => { unpicked += 1; }), /offline/);
  assert.equal(unpicked, 1);
});

test("sendPicked names a failed unpick too", async () => {
  await assert.rejects(
    sendPicked(fakeAgent("idle", { failSend: true }), "hi", async () => { throw new Error("store locked"); }),
    /send failed.*store locked/,
  );
});
