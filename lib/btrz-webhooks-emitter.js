const Queue = require("btrz-sqs").Queue;
const config = require("../config.js")(process.env);
const uuid = require("uuid");

module.exports = {
  emitEvent(eventName, attrs, logger) {
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

    if (!config.aws.key || !config.aws.secret || !config.aws.sqs.webhooks.queueUrl) {
      if (process.env.NODE_ENV !== "test") {
        logError(new Error("invalid aws configuration."));
      }
      return Promise.resolve();
    }

    let queue = null;
    let msg = null;
    try {
      queue = new Queue(config.aws, "webhooks");
      msg = Queue.createMessage(uuid.v4(), this.buildMessage(eventName, attrs));
    } catch (err) {
      logError(err);
      return Promise.resolve();
    }

    return queue.send([msg])
      .then(() => {
        logInfo(`${eventName} emitted!`);
      })
      .catch(logError);
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
    const data = Object.assign({}, attrs.data);

    return {
      id: uuid.v4(),
      ts: Date.now(),
      providerId: attrs.providerId,
      event: eventName,
      data: this.filterFields(eventName, data) || {}
    };
  },

  filterFields(eventName, data) {    
    const deniedFields = getDeniedFields(eventName);
    const fieldIsAllowed = (field) => {
      return deniedFields.findIndex((denied) => {
        return denied.toString().toLowerCase() === field.toString().toLowerCase();
      }) === -1;
    };

    if (Array.isArray(data)) {
      return data.filter((elem, field) => {
        return fieldIsAllowed(field);
      });
    }

    if (typeof data === "object" && data !== null) {
      Object.keys(data).forEach((key) => {
        if (!fieldIsAllowed(key)) {
          delete data[key];
        }
      });
    }

    return data;
  }
};

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

