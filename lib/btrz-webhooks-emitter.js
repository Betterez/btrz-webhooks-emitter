"use strict";

const Queue = require("btrz-sqs").Queue,
  config = require("../config")(process.env),
  queue = new Queue(config.aws, "webhooks");

module.exports = {
  emitEvent(eventName, data, logger) {
    try {
      const msg = Queue.createMessage("theId", this.buildMessage(eventName, data));
      queue.send([msg]);
    } catch (err) {
      if (logger && logger.error) {
        logger.error(err.toString());
      } else {
        console.log(err.toString());
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

