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

module.exports = {
  async emitEvent(eventName, attrs, logger) {
    function logError(err) {
      if (logger && logger.error) {
        logger.error(`btrz-webhooks-emitter::emitEvent() - ${err.toString()}`);
      } else {
        console.log(`ERROR - btrz-webhooks-emitter::emitEvent() - ${err.toString()}`);
      }
    }

    function logInfo(msg) {
      if (logger && logger.info) {
        logger.info(`btrz-webhooks-emitter::emitEvent() - ${msg.toString()}`);
      } else {
        console.log(`INFO - btrz-webhooks-emitter::emitEvent() - ${msg.toString()}`);
      }
    }

    try {
      await trace("btrz-webhooks-emitter emitEvent", async () => {
        if (!config.aws.key || !config.aws.secret || !config.aws.sqs.webhooks.queueUrl) {
          if (process.env.NODE_ENV === "test") {
            emitForTesting({eventName, attrs});
            return;
          }

          throw new Error("invalid aws configuration.");
        }

        const queue = new Queue(config.aws, "webhooks");
        const msg = Queue.createMessage(uuid.v4(), this.buildMessage(eventName, attrs));

        await queue.send([msg]);
        logInfo(`${eventName} emitted!`);
      });
      return undefined;
    } catch (error) {
      logError(error);
      return undefined;
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
