const {Writable} = require('stream');
const {spawn} = require('child_process');
const onExit = require('signal-exit');
const {SQSClient, SendMessageCommand, SendMessageBatchCommand} = require('@aws-sdk/client-sqs');
const {chunk} = require('lodash/fp');
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
    client.send(
      new SendMessageCommand({
        QueueUrl: 'http://localhost:9324/queue/MyFirstQueue',
        MessageBody: 'MyFirstMessage',
        MessageAttributes: {
          myAttribute: {DataType: 'String', StringValue: 'myAttribute'}
        }
      })
    ),
    client.send(
      new SendMessageCommand({
        QueueUrl: 'http://localhost:9324/queue/MySecondQueue',
        MessageBody: 'MySecondMessage'
      })
    ),
    client.send(
      new SendMessageCommand({
        QueueUrl: 'http://localhost:9324/queue/MyThirdQueue',
        MessageBody: 'MyThirdMessage'
      })
    ),
    client.send(
      new SendMessageCommand({
        QueueUrl: 'http://localhost:9324/queue/MyFourthQueue',
        MessageBody: 'MyFourthMessage'
      })
    ),
    ...chunk(
      10,
      Array.from({length: 70}).map((_, Id) => ({
        Id: `${Id}`,
        MessageBody: 'MyLargestBatchSizeQueue'
      }))
    ).map(Entries =>
      client.send(
        new SendMessageBatchCommand({
          QueueUrl: 'http://localhost:9324/queue/MyLargestBatchSizeQueue',
          Entries
        })
      )
    )
  ]);
};

const serverless = spawn('sls', ['offline', 'start', '--config', 'serverless.sqs.yml'], {
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

      if (this.count === 5) serverless.kill();
      cb();
    }
  })
);

serverless.on('close', code => {
  process.exit(code);
});

onExit((code, signal) => {
  if (signal) serverless.kill(signal);
});
