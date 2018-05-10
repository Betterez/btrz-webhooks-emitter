# btrz-webhooks-emitter

Betterez library for emitting webhooks to the SQS queue.

# Configuration
This lib will use the following ENV variables:
  * AWS_SERVICE_KEY
  * AWS_SERVICE_SECRET
  * SQS_QUEUE_URL

# How to use
```javascript
const btrzEmitter = require("btrz-webhooks-emitter");

const attrs = {
  providerId: "123",
  apiKey: "PROVIDER_PUBLIC_KEY",
  data: {foo: "bar"}
};

btrzEmitter.emitEvent("transaction.created", attrs);
```

`btrzEmitter.emitEvent()` will send asynchronously a message to SQS and no response, it will log an error if exists.

It's recommendable to send a third param with the logger you are using:
```javascript
btrzEmitter.emitEvent("transaction.created", attrs, logger);
```

# Denied fields
`denied-fields/index.js` contains information about which fields have to be removed from the data before sending to SQS.
They can be set by event name like `transaction.created` or using wildcards like `*` or `transaction.*`
 
# Test
`AWS_SERVICE_KEY=YOUR_KEY AWS_SERVICE_SECRET=YOUR_SECRET_KEY SQS_QUEUE_URL=YOUR_QUEUE_URL npm test`
