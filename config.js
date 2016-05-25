module.exports = {

    // The order of items matters. Most specific should be first. Wildcard (.*) should be last.
    items: [
        //{ Search: 'SomeTable', UseRegex: false, MinReads: 1, MaxReads: 50, MinWrites: 1, MaxWrites: 50, AssessmentMinutes: 2, IncrementBuffer: 5, DecrementPercentBarrier: 65, DecrementMinutesBarrier: 60 },
        { Search: '.*', UseRegex: true, MinReads: 1, MaxReads: 50, MinWrites: 1, MaxWrites: 50, AssessmentMinutes: 2, IncrementBuffer: 5, DecrementPercentBarrier: 65, DecrementMinutesBarrier: 60 }        
    ],

};
