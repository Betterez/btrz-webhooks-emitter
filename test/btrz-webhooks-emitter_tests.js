describe("index", () => {
  const expect = require("chai").expect;
  const btrzEmitter = require("../index.js");
  const logger = require("./helpers/logger.js");
  const uuidReg = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  afterEach(() => {
    if (logger.error.restore) {
      logger.error.restore();
    }
    if (logger.info.restore) {
      logger.info.restore();
    }
  });

  describe("unit tests", () => {
    describe("buildMessage()", () => {
      it("should return the object with the data in the attrs object", () => {
        const attrs = {
          providerId: "123",
          data: {foo: "bar"}
        };
        const msg = btrzEmitter.buildMessage("transaction.created", attrs);

        expect(msg.id).to.match(uuidReg);
        expect(msg.providerId).to.be.eql(attrs.providerId);
        expect(msg.data).to.be.eql(attrs.data);
        expect(msg.ts).to.not.be.eql(undefined);
        expect(msg.event).to.be.eql("transaction.created");
      });

      it("should return the object using data empty object as default", () => {
        const attrs = {
          providerId: "123"
        };
        const msg = btrzEmitter.buildMessage("ticket.created", attrs);

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

      it("should return the object with allowed fields in data", () => {
        const attrs = {
          providerId: "123",
          data: {
            "key1": true,
            "key2": false,
            "password": "123"
          }
        };
        const msg = btrzEmitter.buildMessage("ticket.created", attrs);

        expect(msg.id).to.match(uuidReg);
        expect(msg.providerId).to.be.eql(attrs.providerId);
        expect(msg.ts).to.not.be.eql(undefined);
        expect(msg.event).to.be.eql("ticket.created");
        expect(Object.keys(msg.data)).to.be.eql(["key1", "key2"]);
      });
    });

    describe("filterFields()", () => {
      describe("with arrays..", () => {
        it("should pass complete with no denied fields", () => {
          const data = ["test"];
          expect(btrzEmitter.filterFields("customer.created", data)).to.be.eql(data);
        });

        it("should pass complete because the key is 0", () => {
          const data = ["password"];
          expect(btrzEmitter.filterFields("customer.created", data)).to.be.eql(data);
        });

        it("should filter off the denied 'password' field", () => {
          const data = [];
          data.password = "test";
          expect(btrzEmitter.filterFields("customer.created", data)).to.be.eql([]);
        });

        it("should filter off the denied 'credentials' field", () => {
          const data = [];
          data.credentials = "test";
          expect(btrzEmitter.filterFields("customer.created", data)).to.be.eql([]);
        });
      });

      describe("with objects..", () => {
        it("should pass complete with no denied fields", () => {
          const data = {"test": "password"};
          expect(btrzEmitter.filterFields("customer.created", data)).to.be.eql(data);
        });

        it("should filter off the denied 'password' field", () => {
          const data = {"password": "test"};
          expect(btrzEmitter.filterFields("customer.created", data)).to.be.eql({});
        });

        it("should filter off the denied 'credentials' field", () => {
          const data = {"credentials": "test", "createdAt": "10:00"};
          expect(btrzEmitter.filterFields("customer.created", data)).to.be.eql({"createdAt": "10:00"});
        });

        it("should filter off the denied fields between allowed ones", () => {
          const data = {
            "key1": "foo",
            "credentials": "test",
            "another_valid": true
          };
          expect(Object.keys(btrzEmitter.filterFields("customer.created", data))).to.be.eql(["key1", "another_valid"]);
        });
      });
    });
  });
});
