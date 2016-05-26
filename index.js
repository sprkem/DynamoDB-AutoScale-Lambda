var AWS = require('aws-sdk');
AWS.config.apiVersions = { dynamodb: '2012-08-10', cloudwatch: '2010-08-01' };
var dynamodb;
var cloudwatch;

var config = require('./config');

var allTables;
var tableConfigs;
var changeCount;

exports.handler = (event, context, callback) => {

    AWS.config.update({ region: event.region });
    dynamodb = new AWS.DynamoDB();
    cloudwatch = new AWS.CloudWatch();

    allTables = [];
    tableConfigs = [];
    changeCount = 0;

    GetTables()
        .then(MatchTablesWithConfig)
        .then(ProcessTables)
        .then(function () {
            callback(null, 'Done');
        })
        .catch(function (err) {
            console.error('An error occurred', err);
            callback(err, 'fail');
        });

};

const GetTables = (startTable) => {
    return new Promise(function (resolve, reject) {

        var params = { ExclusiveStartTableName: startTable };
        dynamodb.listTables(params, function (err, data) {
            if (err) reject(err);
            else {

                for (var i = 0; i < data.TableNames.length; i++) allTables.push(data.TableNames[i]);

                if (data.LastEvaluatedTableName)
                    GetTables(data.LastEvaluatedTableName).then(function () { resolve(); });
                else
                    resolve();
            }
        });

    });
};

const MatchTablesWithConfig = () => {
    return new Promise(function (resolve, reject) {

        for (var i = 0; i < allTables.length; i++) {

            for (var y = 0; y < config.items.length; y++) {

                if (config.items[y].UseRegex) {
                    if (new RegExp(config.items[y].Search).test(allTables[i]))
                        tableConfigs.push({ Table: allTables[i], Config: config.items[y] });
                }
                else {
                    if (config.items[y].Search === allTables[i]) tableConfigs.push({ Table: allTables[i], Config: config.items[y] });
                }
            }
        }
        resolve();
    });
};

const ProcessTables = () => {
    return new Promise(function (resolve, reject) {

        // Unfortunately we have to do each table in turn or we are likely to get this:
        // Exception: The rate of control plane requests made by this account is too high
        var calls = [];
        for (var i = 0; i < tableConfigs.length; i++) {
            calls.push(ProcessTable);
        };

        var res = new Promise(function (resolve, reject) {
            resolve({ currentIndex: 0 });
        });
        calls.forEach(function (f) {
            res = res.then(f);
        });

        res = res.then(function () { resolve(); });
        res = res.catch(function (err) { reject(err); });
    });
};

const ProcessTable = (param) => {
    return new Promise(function (resolve, reject) {

        var table = tableConfigs[param.currentIndex].Table;
        var config = tableConfigs[param.currentIndex].Config;

        console.log('process for ' + table);

        var tableInfo = { Table: table, Config: config };
        DescribeTable(tableInfo)
            .then(GetAllMetricsForTable)
            .then(UpdateTableCapacity)
            .then(function (name) {
                console.log('finished processing ' + name);
                param.currentIndex++;
                resolve(param);
            })
            .catch(function (err) {
                reject(err);
            });
    });
};


const DescribeTable = (tableInfo) => {
    return new Promise(function (resolve, reject) {

        var params = { TableName: tableInfo.Table };
        dynamodb.describeTable(params, function (err, data) {
            if (err) reject(err);
            else {                
                if (data.Table.GlobalSecondaryIndexes && data.Table.GlobalSecondaryIndexes.length > 0) {
                    tableInfo.Indices = [];
                    for (var i = 0; i < data.Table.GlobalSecondaryIndexes.length; i++) {
                        var index = data.Table.GlobalSecondaryIndexes[i];
                        tableInfo.Indices.push({
                            IndexName: index.IndexName,
                            NumberOfDecreasesToday: index.ProvisionedThroughput.NumberOfDecreasesToday,
                            ReadCapacityUnits: index.ProvisionedThroughput.ReadCapacityUnits,
                            WriteCapacityUnits: index.ProvisionedThroughput.WriteCapacityUnits,
                            LastDecreaseDateTime: index.ProvisionedThroughput.LastDecreaseDateTime
                        });
                    }
                }

                tableInfo.NumberOfDecreasesToday = data.Table.ProvisionedThroughput.NumberOfDecreasesToday;
                tableInfo.ReadCapacityUnits = data.Table.ProvisionedThroughput.ReadCapacityUnits;
                tableInfo.WriteCapacityUnits = data.Table.ProvisionedThroughput.WriteCapacityUnits;
                tableInfo.LastDecreaseDateTime = data.Table.ProvisionedThroughput.LastDecreaseDateTime;
                resolve(tableInfo);
            }
        });

    });
};

const GetAllMetricsForTable = (tableInfo) => {
    return new Promise(function (resolve, reject) {

        var promises = [];
        promises.push(GetMetricsForTableOrIndex(tableInfo, 'ConsumedReadCapacityUnits', null));
        promises.push(GetMetricsForTableOrIndex(tableInfo, 'ConsumedWriteCapacityUnits', null));

        if (tableInfo.Indices) {
            for (var i = 0; i < tableInfo.Indices.length; i++) {
                promises.push(GetMetricsForTableOrIndex(tableInfo, 'ConsumedReadCapacityUnits', tableInfo.Indices[i]));
                promises.push(GetMetricsForTableOrIndex(tableInfo, 'ConsumedWriteCapacityUnits', tableInfo.Indices[i]));
            }
        }

        Promise.all(promises).then(function () {
            resolve(tableInfo);
        }, function () {
            reject();
        });

    });
};

const GetMetricsForTableOrIndex = (tableInfo, metricName, indexInfo) => {
    return new Promise(function (resolve, reject) {

        var params = {
            EndTime: new Date(),
            MetricName: metricName,
            Namespace: 'AWS/DynamoDB',
            Period: 60,
            StartTime: new Date(),
            Statistics: ['Sum'],
            Dimensions: [{ Name: 'TableName', Value: tableInfo.Table }],
            Unit: 'Count'
        };
        params.StartTime.setMinutes(params.EndTime.getMinutes() - tableInfo.Config.AssessmentMinutes);
        if (indexInfo) params.Dimensions.push({ Name: 'GlobalSecondaryIndexName', Value: indexInfo.IndexName });

        cloudwatch.getMetricStatistics(params, function (err, data) {
            if (err) reject(err);
            else {

                if (data.Datapoints && data.Datapoints.length > 0) {
                    var sum = 0;
                    for (var i = 0; i < data.Datapoints.length; i++) sum += data.Datapoints[i].Sum / 60;
                    var average = sum / data.Datapoints.length;

                    if (indexInfo) indexInfo[data.Label] = average;
                    else tableInfo[data.Label] = average;
                }
                resolve();
            }
        });

    });
};

const UpdateTableCapacity = (tableInfo) => {
    return new Promise(function (resolve, reject) {

        var scalingActions = [];
        var hasUpdate = false;

        var action = {
            Table: tableInfo.Table,
            Index: null,
            Read: DetermineTableUpdates('read', tableInfo),
            Write: DetermineTableUpdates('write', tableInfo)
        };

        if (action.Read.IsChange || action.Write.IsChange)
            hasUpdate = true;

        if (tableInfo.Indices) {
            action.Indices = [];
            for (var i = 0; i < tableInfo.Indices.length; i++) {
                var indexAction = {
                    Table: tableInfo.Table,
                    Index: tableInfo.Indices[i].IndexName,
                    Read: DetermineTableUpdates('read', tableInfo, tableInfo.Indices[i]),
                    Write: DetermineTableUpdates('write', tableInfo, tableInfo.Indices[i])
                };

                if (indexAction.Read.IsChange || indexAction.Write.IsChange) {
                    hasUpdate = true;
                    action.Indices.push(indexAction);
                }
            }
        };

        if (hasUpdate && changeCount < 10) {
            changeCount++;
            console.log('writing update for ' + action.Table);

            var params = { TableName: action.Table };
            if (action.Read.IsChange || action.Write.IsChange)
                params.ProvisionedThroughput = { ReadCapacityUnits: action.Read.NewValue, WriteCapacityUnits: action.Write.NewValue }

            if (action.Indices && action.Indices.length > 0) {

                params.GlobalSecondaryIndexUpdates = [];
                for (var i = 0; i < action.Indices.length; i++) {
                    params.GlobalSecondaryIndexUpdates.push({
                        Update: {
                            IndexName: action.Indices[i].Index,
                            ProvisionedThroughput: { ReadCapacityUnits: action.Indices[i].Read.NewValue, WriteCapacityUnits: action.Indices[i].Write.NewValue }
                        }
                    });
                }
            }

            dynamodb.updateTable(params, function (err, data) {
                if (err) reject(err);
                else resolve(tableInfo.Table);
            });
        }
        else {
            resolve(tableInfo.Table);
        }

    });
};

const DetermineTableUpdates = (type, tableInfo, indexInfo) => {

    var info;
    if (indexInfo) info = indexInfo; else info = tableInfo;

    var consumedProperty = type == 'read' ? 'ConsumedReadCapacityUnits' : 'ConsumedWriteCapacityUnits';
    var currentCapacityProperty = type == 'read' ? 'ReadCapacityUnits' : 'WriteCapacityUnits';
    var minValueProperty = type == 'read' ? 'MinReads' : 'MinWrites';
    var maxValueProperty = type == 'read' ? 'MaxReads' : 'MaxWrites';

    var consumed = 0;
    var desired = 0;
    var direction = '';
    var doChange = true;

    // Calc table actions
    consumed = info[consumedProperty] || 0;
    if ((consumed > 1) && (consumed + tableInfo.Config.IncrementBuffer > info[currentCapacityProperty])) direction = 'up'; else direction = 'down';

    if (direction === 'up') {
        desired = Math.min(Math.ceil(consumed + tableInfo.Config.IncrementBuffer), tableInfo.Config[maxValueProperty]);
    }
    else if (direction === 'down') {

        desired = Math.max(Math.max(Math.ceil(consumed), 1), tableInfo.Config[minValueProperty]);
        var percentageOfCurrent = (desired / info[currentCapacityProperty]) * 100;

        decrementDateBarrier = new Date();
        decrementDateBarrier.setMinutes(new Date().getMinutes() - tableInfo.Config.DecrementMinutesBarrier);

        if (info.NumberOfDecreasesToday == 4) doChange = false;
        if (info.LastDecreaseDateTime >= decrementDateBarrier) doChange = false;
        if ((desired >= 10) && (tableInfo.Config.DecrementPercentBarrier < percentageOfCurrent)) doChange = false;

        var actualTime = new Date(Date.now());
        var endOfDay = new Date(actualTime.getFullYear(), actualTime.getMonth(), actualTime.getDate() + 1, 0, 0, 0);
        var timeRemainingHours = (endOfDay.getTime() - actualTime.getTime()) / 1000 / 60 / 60;
        if (Math.max((timeRemainingHours / 6), 1) > (4 - info.NumberOfDecreasesToday)) doChange = false;
    }

    // If not marked for change, we might still want to change to enforce min/max
    if (!doChange) desired = Math.min(Math.max(info[currentCapacityProperty], tableInfo.Config[minValueProperty]), tableInfo.Config[maxValueProperty]);

    return { IsChange: desired != info[currentCapacityProperty], NewValue: desired };

};
