"use strict";

const Queue = require("btrz-sqs").Queue,
  config = require("../config")(process.env);

module.exports = {
  emitEvent(eventName, data, logger) {
    function logError(err) {
      if (logger && logger.error) {
        logger.error(`btrz-webhooks-emitter::emitEvent() - ${err.toString()}`);
      }
    }

    if (!config.aws.key || !config.aws.secret || !config.aws.sqs.webhooks.queueUrl) {
      if (logger && logger.error) {
        logger.error("invalid aws configuration.");
      } else {
        console.log("invalid aws configuration.");
      }
      return;
    }

    let queue, msg;
    try {
      queue = new Queue(config.aws, "webhooks");
      msg = Queue.createMessage("theId", this.buildMessage(eventName, data));
    } catch (err) {
      return logError(err);
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

    return {
      id: require("uuid/v4")(),
      ts: Date.now(),
      providerId: attrs.providerId,
      apiKey: attrs.apiKey,
      event: eventName,
      data: attrs.data || {}
    };
  }
};

