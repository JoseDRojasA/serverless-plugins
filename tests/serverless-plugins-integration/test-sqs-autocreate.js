const {Writable} = require('stream');
const {spawn} = require('child_process');
const onExit = require('signal-exit');
const {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  GetQueueUrlCommand,
  DeleteQueueCommand
} = require('@aws-sdk/client-sqs');
const pump = require('pump');
const {getSplitLinesTransform} = require('./utils');

const client = new SQSClient({
  region: 'eu-west-1',
  accessKeyId: 'local',
  secretAccessKey: 'local',
  endpoint: 'http://localhost:9324'
});

const sendMessages = () => {
  return Promise.all([
    client.send(new SendMessageCommand({
      QueueUrl: 'http://localhost:9324/queue/AutocreatedImplicitQueue',
      MessageBody: 'AutocreatedImplicitQueue'
    })),
    client.send(new SendMessageCommand({
      QueueUrl: 'http://localhost:9324/queue/AutocreatedQueue',
      MessageBody: 'AutocreatedQueue',
    })),
    client.send(new SendMessageCommand({
      QueueUrl: 'http://localhost:9324/queue/AutocreatedFifoQueue.fifo',
      MessageBody: 'AutocreatedFifoQueue',
      MessageGroupId: '1',
    })),
  ]);
};

const serverless = spawn('sls', ['offline', 'start', '--config', 'serverless.sqs.autocreate.yml'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: __dirname
});

pump(
  serverless.stderr,
  getSplitLinesTransform(),
  new Writable({
    objectMode: true,
    write(line, enc, cb) {
      console.log(line.toString());
      if (/Starting Offline SQS/.test(line)) {
        sendMessages()
          .then(() => console.log('sucessfully send messages'))
          .catch(err => {
            console.log('Some issue sending message:s', err.message);
          });
      }

      this.count =
        (this.count || 0) +
        (line.match(/\(λ: .*\) RequestId: .* Duration: .* ms {2}Billed Duration: .* ms/g) || [])
          .length;
      if (this.count === 3) serverless.kill();
      cb();
    }
  })
);

async function pruneQueue(QueueName) {
  const {QueueUrl} = await client.send(new GetQueueUrlCommand({
    QueueName
  })).catch(err => {
      console.log(`Ignore issue that occured pruning ${QueueName}: ${err.message}`);
      return {QueueUrl: null};
    });
  if (QueueUrl) await client.send(new DeleteQueueCommand({QueueUrl}));
}

async function cleanUp() {
  await Promise.all([
    pruneQueue('AutocreatedImplicitQueue'),
    pruneQueue('AutocreatedQueue'),
    pruneQueue('AutocreatedFifoQueue.fifo')
  ]);
}

serverless.on('close', code => {
  cleanUp()
    .then(() => {
      return process.exit(code);
    })
    .catch(err => {
      console.error(`Queue deletion failed: ${err.message}`);
      process.exit(code || 12);
    });
});

onExit((code, signal) => {
  if (signal) serverless.kill(signal);
});
