"use strict";

const Queue = require("btrz-sqs").Queue,
  config = require("../config")(process.env),
  queue = new Queue(config.aws, "webhooks");

module.exports = {
  emitEvent(eventName, data, logger) {
    try {
      const msg = Queue.createMessage("theId", this.buildMessage(eventName, data));
      queue.send([msg]);

      const infoLog = `btrz-webhooks-emitter::emitEvent() - ${eventName} emitted!`;
      if (logger && logger.info) {
        logger.info(infoLog);
      } else {
        console.log(infoLog);
      }

    } catch (err) {
      const errMsg = `btrz-webhooks-emitter::emitEvent() - ${err.toString()}`;

      if (logger && logger.error) {
        logger.error(errMsg);
      } else {
        console.log(errMsg);
      }
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

    return {
      id: require("uuid/v4")(),
      ts: Date.now(),
      providerId: attrs.providerId,
      event: eventName,
      data: attrs.data || {}
    };
  }
};

