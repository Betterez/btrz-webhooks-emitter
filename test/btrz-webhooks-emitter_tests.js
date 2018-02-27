"use strict";

describe("index", () => {
  const expect = require("chai").expect,
    btrzEmitter = require("../index.js"),
    logger = require("./helpers/logger"),
    sinon = require("sinon"),
    uuidReg = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  describe("emitEvent", () => {
    it("should send the msg to sqs", () => {
      const spy = sinon.spy(logger, "error"),
        attrs = {
          providerId: "123",
          data: {foo: "bar"}
        };

      btrzEmitter.emitEvent("transaction.created", attrs, logger);
      expect(spy.called).to.be.eql(false);
      logger.error.restore();
    });

    it("should log error and do nothing if buildMessage() throw for event name missing", () => {
      const spy = sinon.spy(logger, "error"),
        attrs = {
          providerId: "123",
          data: {foo: "bar"}
        };

      btrzEmitter.emitEvent(null, attrs, logger);
      expect(spy.getCall(0).args[0]).to.be.eql("Error: event name is missing.");
      logger.error.restore();
    });

    it("should log error and do nothing if buildMessage() throw for providerId missing", () => {
      const spy = sinon.spy(logger, "error"),
        attrs = {
          data: {foo: "bar"}
        };

      btrzEmitter.emitEvent("transaction.updated", attrs, logger);
      expect(spy.getCall(0).args[0]).to.be.eql("Error: providerId is missing in attrs.");
      logger.error.restore();
    });
  });

  describe("buildMessage", () => {
    it("should return the object with the data in the attrs object", () => {
      const attrs = {
          providerId: "123",
          data: {foo: "bar"}
        }, 
        msg = btrzEmitter.buildMessage("transaction.created", attrs);

      expect(msg.id).to.match(uuidReg);
      expect(msg.providerId).to.be.eql(attrs.providerId);
      expect(msg.data).to.be.eql(attrs.data);
      expect(msg.ts).to.not.be.eql(undefined);
      expect(msg.event).to.be.eql("transaction.created");
    });

    it("should return the object using data empty object as default", () => {
      const attrs = {
          providerId: "123"
        }, 
        msg = btrzEmitter.buildMessage("ticket.created", attrs);

      expect(msg.id).to.match(uuidReg);
      expect(msg.providerId).to.be.eql(attrs.providerId);
      expect(msg.data).to.be.eql({});
      expect(msg.ts).to.not.be.eql(undefined);
      expect(msg.event).to.be.eql("ticket.created");
    });

    it("should throw if providerId was not sent", () => {
      const attrs = {
        data: {foo: "bar"}
      };

      function sut() {
        btrzEmitter.buildMessage("transaction.created", attrs);
      }

      expect(sut).to.throw("providerId is missing in attrs.");
    });

    it("should throw if the event name is not sent", () => {
      function sut() {
        btrzEmitter.buildMessage();
      }

      expect(sut).to.throw("event name is missing.");
    });

    it("should throw if the event name is empty string", () => {
      const attrs = {
        providerId: "123",
        data: {foo: "bar"}
      };

      function sut() {
        btrzEmitter.buildMessage("", attrs);
      }

      expect(sut).to.throw("event name can not be empty.");
    });

    it("should throw if the event name is not string", () => {
      const attrs = {
        providerId: "123",
        data: {foo: "bar"}
      };

      function sut() {
        btrzEmitter.buildMessage({}, attrs);
      }

      expect(sut).to.throw("event name must be a string.");
    });
  });
});
