describe("index", () => {
  const expect = require("chai").expect;
  const zlib = require("zlib");
  const btrzEmitter = require("../index.js");
  const logger = require("./helpers/logger.js");
  const uuidReg = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const WEBHOOK_COMPRESS_KEY = "WEBHOOK_COMPRESS";
  const originalWebhookCompress = process.env[WEBHOOK_COMPRESS_KEY];
  after(() => {
    if (originalWebhookCompress !== undefined) {
      process.env[WEBHOOK_COMPRESS_KEY] = originalWebhookCompress;
    } else {
      delete process.env[WEBHOOK_COMPRESS_KEY];
    }
  });

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

      describe("WEBHOOK_COMPRESS", () => {
        beforeEach(() => {
          delete process.env[WEBHOOK_COMPRESS_KEY];
        });

        it("should leave data as object and not set enc when WEBHOOK_COMPRESS is unset", () => {
          const attrs = {providerId: "123", data: {foo: "bar"}};
          const msg = btrzEmitter.buildMessage("transaction.created", attrs);

          expect(msg.enc).to.be.undefined;
          expect(msg.data).to.be.eql({foo: "bar"});
        });

        it("should leave data as object when WEBHOOK_COMPRESS is not zstd or gzip", () => {
          process.env[WEBHOOK_COMPRESS_KEY] = "br";
          const attrs = {providerId: "123", data: {foo: "bar"}};
          const msg = btrzEmitter.buildMessage("transaction.created", attrs);

          expect(msg.enc).to.be.undefined;
          expect(msg.data).to.be.eql({foo: "bar"});
        });

        it("should set enc to zstd and compress data when WEBHOOK_COMPRESS=zstd", () => {
          process.env[WEBHOOK_COMPRESS_KEY] = "zstd";
          const attrs = {providerId: "123", data: {foo: "bar", nested: {a: 1}}};
          const msg = btrzEmitter.buildMessage("transaction.created", attrs);

          expect(msg.enc).to.eql("zstd");
          expect(typeof msg.data).to.eql("string");
          const decompressed = JSON.parse(zlib.zstdDecompressSync(Buffer.from(msg.data, "base64")).toString("utf8"));
          expect(decompressed).to.eql(attrs.data);
        });

        it("should set enc to gzip and compress data when WEBHOOK_COMPRESS=gzip", () => {
          process.env[WEBHOOK_COMPRESS_KEY] = "gzip";
          const attrs = {providerId: "123", data: {foo: "bar"}};
          const msg = btrzEmitter.buildMessage("transaction.created", attrs);

          expect(msg.enc).to.eql("gzip");
          expect(typeof msg.data).to.eql("string");
          const decompressed = JSON.parse(zlib.gunzipSync(Buffer.from(msg.data, "base64")).toString("utf8"));
          expect(decompressed).to.eql(attrs.data);
        });

        it("should treat WEBHOOK_COMPRESS case-insensitively (ZSTD)", () => {
          process.env[WEBHOOK_COMPRESS_KEY] = "ZSTD";
          const attrs = {providerId: "123", data: {x: 1}};
          const msg = btrzEmitter.buildMessage("transaction.created", attrs);

          expect(msg.enc).to.eql("zstd");
          const decompressed = JSON.parse(zlib.zstdDecompressSync(Buffer.from(msg.data, "base64")).toString("utf8"));
          expect(decompressed).to.eql({x: 1});
        });

        it("should compress filtered data (only allowed fields) when using zstd", () => {
          process.env[WEBHOOK_COMPRESS_KEY] = "zstd";
          const attrs = {
            providerId: "123",
            data: {key1: "a", password: "secret", key2: "b"}
          };
          const msg = btrzEmitter.buildMessage("ticket.created", attrs);

          expect(msg.enc).to.eql("zstd");
          const decompressed = JSON.parse(zlib.zstdDecompressSync(Buffer.from(msg.data, "base64")).toString("utf8"));
          expect(decompressed).to.eql({key1: "a", key2: "b"});
        });
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
