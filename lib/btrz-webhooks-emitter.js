const Queue = require("btrz-sqs").Queue;
const {trace} = require("btrz-monitoring");
const zlib = require("zlib");
const config = require("../config.js")(process.env);
const uuid = require("uuid");

const VALID_COMPRESS = new Set(["zstd", "gzip"]);

function getCompressAlgo() {
  const v = (process.env.WEBHOOK_COMPRESS || "").toLowerCase();
  return VALID_COMPRESS.has(v) ? v : null;
}

function compressData(data, algo) {
  const json = JSON.stringify(data);
  const buf = Buffer.from(json, "utf8");
  const compressed = algo === "zstd" ?
    zlib.zstdCompressSync(buf) :
    zlib.gzipSync(buf);
  return compressed.toString("base64");
}

function getDeniedFields(eventName) {
  const deniedFields = require("btrz-webhooks-denied-fields").getFields();
  let result = deniedFields["*"] || [];

  const wildcard = `${eventName.split(".")[0]}.*`;
  if (deniedFields[wildcard]) {
    result = result.concat(deniedFields[wildcard]);
  }
  if (deniedFields[eventName]) {
    result = result.concat(deniedFields[eventName]);
  }
  return result;
}

const originalStdoutWrite = process.stdout.write;

function emitForTesting(object) {
  // We want our test suites to be able to intercept webhook events, however we don't want the webhook events to be logged to the console
  // as they tend to be very large and can create a lot of noise when running tests.  Only log the webhook events to the console if it looks
  // like someone is intercepting the console output (listening to it).
  const stdoutIsBeingIntercepted = process.stdout.write !== originalStdoutWrite;
  if (process.env.NODE_ENV === "test" && stdoutIsBeingIntercepted) {
    console.log("WHE-PRE");
    console.log(JSON.stringify(object));
  }
}

// Delays (ms) between the re-sends of an event whose publication failed (SQS throttling, 5xx, network).
// The first publication already includes the SDK retries, so these cover outages that last longer than that.
const DEFAULT_RETRY_DELAYS_MS = [30000, 60000, 120000, 300000, 600000];

function createLogger(logger) {
  return {
    error(msg) {
      if (logger && logger.error) {
        logger.error(`btrz-webhooks-emitter::emitEvent() - ${msg.toString()}`);
      } else {
        console.log(`ERROR - btrz-webhooks-emitter::emitEvent() - ${msg.toString()}`);
      }
    },
    info(msg) {
      if (logger && logger.info) {
        logger.info(`btrz-webhooks-emitter::emitEvent() - ${msg.toString()}`);
      } else {
        console.log(`INFO - btrz-webhooks-emitter::emitEvent() - ${msg.toString()}`);
      }
    }
  };
}

module.exports = {
  retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,

  async emitEvent(eventName, attrs, logger) {
    const log = createLogger(logger);
    let message = null;

    try {
      await trace("btrz-webhooks-emitter emitEvent", async () => {
        if (!config.aws.key || !config.aws.secret || !config.aws.sqs.webhooks.queueUrl) {
          if (process.env.NODE_ENV === "test") {
            emitForTesting({eventName, attrs});
            return;
          }

          throw new Error("invalid aws configuration.");
        }

        const built = this.buildMessage(eventName, attrs);
        message = built;
        await this.sendMessage(built);
        log.info(`${eventName} emitted!`);
      });
      return undefined;
    } catch (error) {
      log.error(error);
      if (message) {
        // The event was built but the queue rejected it: keep re-sending it in the background so a transient
        // queue failure does not lose it. The caller is not blocked nor failed by the retries.
        this.scheduleRetry(eventName, message, log, 0);
      }
      return undefined;
    }
  },

  // Re-sends reuse the same built message, so the event keeps its id and consumers can de-duplicate.
  // Queue#send() does not wait for SQS and resolves even when the publication fails (the error ends up as an
  // unhandled rejection), so publish through the queue's SQS client and check the result ourselves.
  async sendMessage(message) {
    const queue = new Queue(config.aws, "webhooks");
    const msg = Queue.createMessage(uuid.v4(), message);
    const result = await queue.sqs.sendMessageBatch({Entries: [msg], QueueUrl: queue.queueConfig.queueUrl});
    const failed = (result && result.Failed) || [];
    if (failed.length > 0) {
      throw new Error(`Failed to send messages: ${failed.map((f) => `${f.Id} (${f.Code || "unknown"})`).join(", ")}`);
    }
  },

  scheduleRetry(eventName, message, log, attempt) {
    const delays = this.retryDelaysMs || [];
    if (attempt >= delays.length) {
      // Last resort: leave the full event in the log so it can be re-sent by hand.
      log.error(`${eventName} could not be emitted after ${attempt + 1} attempts, giving up. Event: ${JSON.stringify(message)}`);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        await this.sendMessage(message);
        log.info(`${eventName} emitted on retry ${attempt + 1}!`);
      } catch (err) {
        log.error(`${eventName} retry ${attempt + 1} failed: ${err.toString()}`);
        this.scheduleRetry(eventName, message, log, attempt + 1);
      }
    }, delays[attempt]);
    if (timer.unref) {
      timer.unref();
    }
  },

  buildMessage(eventName, attrs) {
    if (eventName === "") {
      throw new Error("event name can not be empty.");
    }
    if (!eventName) {
      throw new Error("event name is missing.");
    }
    if (typeof eventName !== "string") {
      throw new Error("event name must be a string.");
    }
    if (!attrs.providerId) {
      throw new Error("providerId is missing in attrs.");
    }

    // clone data to avoid mutation
    const data = this.filterFields(eventName, Object.assign({}, attrs.data)) || {};
    const algo = getCompressAlgo();

    const msg = {
      id: uuid.v4(),
      ts: Date.now(),
      providerId: attrs.providerId,
      event: eventName,
      data: algo ? compressData(data, algo) : data
    };
    if (algo) {
      msg.enc = algo;
    }
    return msg;
  },

  filterFields(eventName, data) {
    const deniedFields = getDeniedFields(eventName);
    function fieldIsAllowed(field) {
      return deniedFields.findIndex((denied) => {
        return denied.toString().toLowerCase() === field.toString().toLowerCase();
      }) === -1;
    }

    if (Array.isArray(data)) {
      return data.filter((elem, field) => {
        return fieldIsAllowed(field);
      });
    }

    if (typeof data === "object" && data !== null) {
      const result = Object.assign({}, data);
      Object.keys(result).forEach((key) => {
        if (!fieldIsAllowed(key)) {
          delete result[key];
        }
      });
      return result;
    }

    return data;
  }
};
