import { test } from "node:test";
import assert from "node:assert/strict";
import { sendWhenIdle, type SenderAgent, type Timers } from "../client/pending-send.ts";

function fakeTimers() {
  const queue: { id: number; fn: () => void }[] = [];
  let next = 1;
  const timers: Timers = {
    set(fn) {
      const id = next++;
      queue.push({ id, fn });
      return id;
    },
    clear(id) {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
  };
  // Fires the pending timer and lets its async work settle.
  const tick = async () => {
    const t = queue.shift();
    t?.fn();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { timers, tick, pending: () => queue.length };
}

function fakeAgent(statuses: (string | null)[]) {
  const sent: string[] = [];
  let i = 0;
  const agent: SenderAgent & { sent: string[] } = {
    status: null,
    sent,
    async refresh() {
      agent.status = statuses[Math.min(i++, statuses.length - 1)] ?? null;
    },
    async send(text) {
      sent.push(text);
    },
  };
  return agent;
}

test("idle agent gets the message at once", async () => {
  const f = fakeTimers();
  const agent = fakeAgent(["idle"]);
  const h = sendWhenIdle(agent, "hi", { timers: f.timers, key: "t1" });
  await h.done;
  assert.deepEqual(agent.sent, ["hi"]);
});

test("running then idle sends once after the change", async () => {
  const f = fakeTimers();
  const agent = fakeAgent(["running", "running", "idle", "idle"]);
  const h = sendWhenIdle(agent, "hi", { timers: f.timers, key: "t2" });
  await f.tick();
  assert.deepEqual(agent.sent, []);
  await f.tick();
  assert.deepEqual(agent.sent, []);
  await f.tick();
  await h.done;
  assert.deepEqual(agent.sent, ["hi"]);
  assert.equal(f.pending(), 0);
});

test("cancel before idle sends nothing", async () => {
  const f = fakeTimers();
  const agent = fakeAgent(["running", "idle"]);
  const h = sendWhenIdle(agent, "hi", { timers: f.timers, key: "t3" });
  await f.tick();
  h.cancel();
  await f.tick();
  await h.done;
  assert.deepEqual(agent.sent, []);
  assert.equal(f.pending(), 0);
});

test("a second call with the same key cancels the first", async () => {
  const f = fakeTimers();
  const a = fakeAgent(["running", "idle"]);
  const b = fakeAgent(["running", "idle"]);
  const h1 = sendWhenIdle(a, "one", { timers: f.timers, key: "t4" });
  await f.tick();
  const h2 = sendWhenIdle(b, "two", { timers: f.timers, key: "t4" });
  await h1.done;
  for (let i = 0; i < 3; i++) await f.tick();
  await h2.done;
  assert.deepEqual(a.sent, []);
  assert.deepEqual(b.sent, ["two"]);
});

test("unknown status keeps polling then gives up with an error", async () => {
  const f = fakeTimers();
  const agent = fakeAgent([null]);
  const h = sendWhenIdle(agent, "hi", { timers: f.timers, key: "t5", intervalMs: 2000, giveUpMs: 6000 });
  const failed = assert.rejects(h.done, /did not report/);
  for (let i = 0; i < 6; i++) await f.tick();
  await failed;
  assert.deepEqual(agent.sent, []);
});

test("other statuses count as not busy", async () => {
  const f = fakeTimers();
  const agent = fakeAgent(["error"]);
  await sendWhenIdle(agent, "hi", { timers: f.timers, key: "t6" }).done;
  assert.deepEqual(agent.sent, ["hi"]);
});
