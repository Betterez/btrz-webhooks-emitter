module.exports = function _default(env) {
  return {
    aws: {
      key: env.AWS_SERVICE_KEY,
      secret: env.AWS_SERVICE_SECRET,
      sqs: {
        webhooks: {
          queueUrl: env.SQS_QUEUE_NAME,
          region: "us-east-1"
        }
      }
    }
  };
};
