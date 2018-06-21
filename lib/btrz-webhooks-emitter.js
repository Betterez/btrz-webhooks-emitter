"use strict";

const Queue = require("btrz-sqs").Queue,
  config = require("../config")(process.env),
  uuidv4 = require("uuid/v4");

module.exports = {
  emitEvent(eventName, attrs, logger) {
    function logError(err) {
      if (logger && logger.error) {
        logger.error(`btrz-webhooks-emitter::emitEvent() - ${err.toString()}`);
      } else {
        console.log(`btrz-webhooks-emitter::emitEvent() - ${err.toString()}`);
      }
    }

    if (!config.aws.key || !config.aws.secret || !config.aws.sqs.webhooks.queueUrl) {
      logError(new Error("invalid aws configuration."));
      return Promise.resolve();
    }

    let queue, msg;
    try {
      queue = new Queue(config.aws, "webhooks");
      msg = Queue.createMessage(uuidv4(), this.buildMessage(eventName, attrs));
    } catch (err) {
      logError(err);
      return Promise.resolve();
    }
    
    return queue.send([msg])
      .then(() => {
        if (logger && logger.info) {
          logger.info(`btrz-webhooks-emitter::emitEvent() - ${eventName} emitted!`);
        }
      })
      .catch((err) => {
        logError(err);
      });
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
    if (!attrs.apiKey) {
      throw new Error("apiKey is missing in attrs.");
    }

    // clone data to avoid mutation
    const data = Object.assign({}, attrs.data);

    return {
      id: uuidv4(),
      ts: Date.now(),
      providerId: attrs.providerId,
      apiKey: attrs.apiKey,
      event: eventName,
      data: this.filterFields(eventName, data) || {}
    };
  },

  filterFields(eventName, data) {    
    const deniedFields = getDeniedFields(eventName),
      fieldIsAllowed = (field) => {
        return deniedFields.indexOf(field.toString().toLowerCase()) === -1;
      };

    if (Array.isArray(data)) {
      return data.filter((elem, field) => {
        return fieldIsAllowed(field);
      })
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

