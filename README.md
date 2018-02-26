# btrz-webhooks-emitter

Betterez library for emitting webhooks to the SQS queue.

# Configuration
This lib will use the following ENV variables:
  * AWS_SERVICE_KEY
  * AWS_SERVICE_SECRET
  * SQS_QUEUE_URL

# Instalation
.
# How to use

``` const attrs = {
      providerId: "123",
      data: {foo: "bar"}
    };

    btrzEmitter.emitEvent("transaction.created", attrs);
```

`btrzEmitter.emitEvent()` will return a promise with the result.

# Test
`AWS_SERVICE_KEY=YOUR_KEY AWS_SERVICE_SECRET=YOUR_SECRET_KEY SQS_QUEUE_NAME=YOUR_QUEUE_URL npm test`
