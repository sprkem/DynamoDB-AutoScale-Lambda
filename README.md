# Dynamo-AutoScale-Lambda
Automatically scales DynamoDB capacity up and down

## Purpose

A simple solution to effectively scale DynamoDB capacity provisioning based. Other solutions exist, however I did not find them suitable for my requirements. The project that forced this requirement was clickstream processing, requiring highly responsive scaling, especially when scaling up.

![Scaling](./scale1.png)

![Scaling](./scale2.png)

## Usage

1. Get the code.
2. Run npm install.
3. Review config.js. See Config section below for info.
4. Zip all of the files.
5. Create an IAM role. See Role section below for info.
5. Create a new AWS Lambda function.
	1. Skip blueprint selection.
	2. Enter a function name.
	3. Ensure Node.js 4.3 is selected as the Runtime
	4. Upload the zip you created earlier.
	5. Choose the role you created earlier.
	6. For Memory, I've always chosen the max value.
	7. For timeout, typical duration for me processing 20 tables in around 1 second. Set a timeout appropriate to your usage.
	8. Add an event source of type CloudWatch Events - Schedule. Set a rate of 1 minute.
	
## Role

Create a new IAM role. Attach the managed policy named 'AWSLambdaBasicExecutionRole'. Then create a role policy with the following statement:

~~~~
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": [
                "dynamodb:ListTables",
                "dynamodb:DescribeTable",
                "dynamodb:UpdateTable",
                "cloudwatch:GetMetricStatistics"
            ],
            "Effect": "Allow",
            "Resource": "*"
        }
    ]
}
~~~~

## Config

The function is driven by whatever settings you place in config.js. The code comes as default with a single config line that enables scaling for all Dynamo Tables in the deployed region:

`{ Search: '.*', UseRegex: true, MinReads: 1, MaxReads: 50, MinWrites: 1, MaxWrites: 50, AssessmentMinutes: 2, IncrementBuffer: 5, DecrementPercentBarrier: 65, DecrementMinutesBarrier: 60 }`

There is a commented out example of a specific table config row also included. The above catch-all config line should always be placed last in the list.

**Search** - The value to search for. Either a table name or regex to match a table name.

**UseRegex** - A boolean indicating if regex should be used to match the Search field with table names.

**MinReads** - The minimum number of reads a table or index should have.

**MaxReads** - The maximum number of writes a table or index should have.

**MinWrites** - The minimum number of reads a table or index should have.

**MaxWrites** - The maximum number of writes a table or index should have.

**AssessmentMinutes** - The number of minutes of CloudWatch metrics to average in order to determine the current consumption. Do not set below 2. Querying CloudWatch for 1 minutes of metrics often results in no data, which may result in scaling down. This value strongly affects the sensitivity of scaling. A higher value may result in short term spikes being ignored.

**IncrementBuffer** - The amount to scale up by. Also used as a proximity measure, meaning if the consumed value plus the buffer is above the capacity, it will take that to mean it should scale up.

**DecrementPercentBarrier** - Prevents scaling down of capacity until the consumed capacity is below this percentage of the current capacity. Geared towards protecting unneccessary scale downs. Ignored when dealing with capacity below 10.

**DecrementMinutesBarrier** - The minimum number of minutes that must have gone by since the last capacity decrement before another can occur.


In addition to these settings, the code stops scaling down based on the time of day. This is because you can only scale a table down 4 times within a UTC day. The function seeks to spread capacity decreases intelligently throughout the day so you don't end up with 20 hours stuck an unneccessarily high capacity.

## Disclaimer

In no event will I be liable for any loss or damage including without limitation, indirect or consequential loss or damage, or any loss or damage whatsoever arising from loss of data or profits arising out of, or in connection with, the use of this code.

