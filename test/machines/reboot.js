/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var checkNotFound = require('../common').checkNotFound;
var waitForJob = require('./common').waitForJob;


// --- Tests


module.exports = function (suite, client, other, machine, callback) {
    if (!machine) {
        return callback();
    }

    suite.test('RebootMachine - other', function (t) {
        other.post('/my/machines/' + machine, {
            action: 'reboot'
        }, function (err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });


    suite.test('RebootMachine', function (t) {
        client.post('/my/machines/' + machine, {
            action: 'reboot'
        }, function (err) {
            t.ifError(err);
            t.end();
        });
    });


    suite.test('Wait For Rebooted', function (t) {
        client.vmapi.listJobs({
            vm_uuid: machine,
            task: 'reboot'
        }, function (err, jobs) {
            t.ifError(err, 'list jobs error');
            t.ok(jobs);
            t.ok(jobs.length);
            waitForJob(client, jobs[0].uuid, function (err2) {
                t.ifError(err2, 'Check state error');
                t.end();
            });
        });
    });

    return callback();
};
