"use strict";

describe("index", () => {
  const expect = require("chai").expect,
    btrzEmitter = require("../index.js");

  describe("emitEvent", () => {
    it("should return the result of the msg sent to sqs", (done) => {
      const attrs = {
        providerId: "123",
        data: {foo: "bar"}
      };

      btrzEmitter.emitEvent("transaction.created", attrs)
        .then((ok) => {
          expect(ok).to.be.eql(true);
          done();
        });
    });
  });

  describe("buildMessage", () => {
    it("should return the object with the data in the attrs object", () => {
      const attrs = {
          providerId: "123",
          data: {foo: "bar"}
        }, 
        msg = btrzEmitter.buildMessage("transaction.created", attrs);

      expect(msg.id).to.not.be.eql(undefined);
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

      expect(msg.id).to.not.be.eql(undefined);
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
