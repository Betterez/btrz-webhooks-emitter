process.env.AWS_SERVICE_KEY = "key";
process.env.AWS_SERVICE_SECRET = "secret";
process.env.SQS_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/000000000000/webhooks";

const {afterEach, beforeEach, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const btrzEmitter = require("../index.js");

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("emitEvent() when the queue rejects the publication", () => {
  const originalSendMessage = btrzEmitter.sendMessage;
  const originalRetryDelays = btrzEmitter.retryDelaysMs;
  let sent;
  let failures;
  let logs;
  const logger = {
    error(msg) {
      logs.error.push(msg);
    },
    info(msg) {
      logs.info.push(msg);
    }
  };

  beforeEach(() => {
    sent = [];
    failures = 0;
    logs = {error: [], info: []};
    btrzEmitter.retryDelaysMs = [5, 5, 5];
    btrzEmitter.sendMessage = async (message) => {
      sent.push(message);
      if (failures > 0) {
        failures -= 1;
        throw new Error("ThrottlingException: Rate exceeded");
      }
    };
  });

  afterEach(() => {
    btrzEmitter.sendMessage = originalSendMessage;
    btrzEmitter.retryDelaysMs = originalRetryDelays;
  });

  it("should send the event once and not retry when the queue accepts it", async () => {
    await btrzEmitter.emitEvent("transaction.completed", {providerId: "123", data: {_id: "trx1"}}, logger);
    await wait(30);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event, "transaction.completed");
    assert.deepStrictEqual(sent[0].data, {_id: "trx1"});
    assert.equal(logs.error.length, 0);
  });

  it("should not reject and should re-send the same event once the queue accepts it again", async () => {
    failures = 2;
    const result = await btrzEmitter.emitEvent("transaction.completed", {providerId: "123", data: {_id: "trx1"}}, logger);
    assert.equal(result, undefined);
    assert.equal(sent.length, 1);
    await wait(60);
    assert.equal(sent.length, 3);
    assert.equal(sent[2], sent[0], "the re-sent event is the same message, with the same id");
    assert.ok(logs.info.some((msg) => msg.includes("transaction.completed emitted on retry 2")));
  });

  it("should give up after the configured retries and log the full event so it can be re-sent", async () => {
    failures = 100;
    await btrzEmitter.emitEvent("transaction.completed", {providerId: "123", data: {_id: "trx1"}}, logger);
    await wait(80);
    assert.equal(sent.length, 4);
    const last = logs.error[logs.error.length - 1];
    assert.match(last, /could not be emitted after 4 attempts, giving up/);
    assert.ok(last.includes(`"id":"${sent[0].id}"`));
  });

  it("should not retry when the event itself is invalid", async () => {
    await btrzEmitter.emitEvent("transaction.completed", {data: {_id: "trx1"}}, logger);
    await wait(30);
    assert.equal(sent.length, 0);
    assert.equal(logs.error.length, 1);
    assert.match(logs.error[0], /providerId is missing in attrs/);
  });
});

describe("sendMessage()", () => {
  const {SQS} = require("@aws-sdk/client-sqs");
  const originalSendMessageBatch = SQS.prototype.sendMessageBatch;
  const originalRetryDelays = btrzEmitter.retryDelaysMs;
  let calls;
  let responses;

  beforeEach(() => {
    calls = [];
    responses = [];
    btrzEmitter.retryDelaysMs = [5, 5, 5];
    SQS.prototype.sendMessageBatch = async function (params) {
      calls.push(params);
      const next = responses.shift() || {Successful: [{Id: params.Entries[0].Id}], Failed: []};
      if (next instanceof Error) {
        throw next;
      }
      return next;
    };
  });

  afterEach(() => {
    SQS.prototype.sendMessageBatch = originalSendMessageBatch;
    btrzEmitter.retryDelaysMs = originalRetryDelays;
  });

  it("should publish the message to the webhooks queue", async () => {
    const message = btrzEmitter.buildMessage("transaction.completed", {providerId: "123", data: {_id: "trx1"}});
    await btrzEmitter.sendMessage(message);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].QueueUrl, process.env.SQS_QUEUE_URL);
    assert.equal(calls[0].Entries.length, 1);
    assert.deepStrictEqual(JSON.parse(calls[0].Entries[0].MessageBody), message);
  });

  it("should reject when SQS rejects the publication", async () => {
    responses = [new Error("ThrottlingException: Rate exceeded")];
    const message = btrzEmitter.buildMessage("transaction.completed", {providerId: "123", data: {_id: "trx1"}});
    await assert.rejects(btrzEmitter.sendMessage(message), /ThrottlingException/);
  });

  it("should reject when SQS reports the entry as failed", async () => {
    responses = [{Successful: [], Failed: [{Id: "1", Code: "InternalError", SenderFault: false}]}];
    const message = btrzEmitter.buildMessage("transaction.completed", {providerId: "123", data: {_id: "trx1"}});
    await assert.rejects(btrzEmitter.sendMessage(message), /Failed to send messages: 1 \(InternalError\)/);
  });

  it("should re-send the event through SQS after SQS rejected the first publication", async () => {
    responses = [new Error("ThrottlingException: Rate exceeded")];
    const logs = {error: [], info: []};
    const logger = {error: (m) => logs.error.push(m), info: (m) => logs.info.push(m)};
    await btrzEmitter.emitEvent("transaction.completed", {providerId: "123", data: {_id: "trx1"}}, logger);
    assert.equal(calls.length, 1);
    await wait(30);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].Entries[0].MessageBody, calls[0].Entries[0].MessageBody);
    assert.ok(logs.info.some((msg) => msg.includes("transaction.completed emitted on retry 1")));
  });
});
