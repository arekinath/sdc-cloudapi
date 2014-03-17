/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * This file defines routes and helpers for Account Users.
 * These "users" match the UFDS sdcAccountUser objectclass.
 *
 * See membership.js for a helper to translate from
 * UFDS sdcAccountUser to CloudAPI user; the file also provides
 * a method to selectively preload all of some of the account
 * users using either the DNs, uuids or the login names.
 */

var assert = require('assert');

var util = require('util'),
    sprintf = util.format;

var restify = require('restify'),
    MissingParameterError = restify.MissingParameterError,
    InvalidArgumentError = restify.InvalidArgumentError;

var vasync = require('vasync');

var membership = require('./membership'),
    preloadGroups = membership.preloadGroups,
    preloadUsers = membership.preloadUsers,
    translateUser = membership.translateUser;

// --- Globals

/* BEGIN JSSTYLED */
var EMAIL_RE = /^[a-zA-Z0-9.!#$%&amp;'*+\-\/=?\^_`{|}~\-]+@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*$/;
/* END JSSTYLED */

var USER_FMT = 'uuid=%s, ou=users, o=smartdc';

// --- Helpers



// Intentionally skipping login & userpassword here:
function parseParams(req) {
    var modifiableProps = ['email', 'cn', 'sn', 'company', 'address', 'city',
        'state', 'postalCode', 'country', 'phone', 'givenName'];

    var params = {};
    modifiableProps.forEach(function (p) {
        if (req.params[p]) {
            params[p] = req.params[p];
        }
    });
    // We change these, check them too:
    if (req.params.companyName) {
        params.company = req.params.companyName;
    }

    if (req.params.firstName) {
        params.givenName = req.params.firstName;
    }

    if (req.params.lastName) {
        params.sn = req.params.lastName;
    }

    if (req.params.firstName && req.params.lastName) {
        params.cn = req.params.firstName + ' ' + req.params.lastName;
    }

    return (params);
}



// --- Functions



function create(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var errors = [];

    var params = parseParams(req);
    if (!params.email) {
        errors.push('email is required');
    }

    if (req.params.login) {
        params.login = req.params.login;
    } else {
        errors.push('login is required');
    }

    if (req.params.password) {
        params.userpassword = req.params.password;
    } else {
        errors.push('password is required');
    }

    // Fail early:
    if (errors.length) {
        return next(new MissingParameterError(
                'Request is missing required parameters: ' +
                errors.join(', ')));
    }

    // I'd say we should do this at UFDS level but, while we don't make a
    // decission, let's go for it here (see CAPI-120):
    if (!EMAIL_RE.test(params.email)) {
        return next(new InvalidArgumentError('email: ' + params.email +
                ' is invalid'));
    }

    // Important bit here!:
    params.account = id;

    return ufds.addUser(params, function (err, user) {
        if (err) {
            log.error({err: err}, 'Create user error');
            if (err.statusCode === 409 &&
                (err.body.code === 'MissingParameter' ||
                err.body.code === 'InvalidArgument')) {
                var msg = err.message;
                if (/userpassword/.test(msg)) {
                    err.message = msg.replace(/userpassword/g, 'password');
                }
                return next(err);
            } else {
                return next(new InvalidArgumentError('user is invalid'));
            }
        }

        user = translateUser(user);
        res.header('Location', sprintf('/%s/users/%s',
                                    req.account.login,
                                    encodeURIComponent(user.login)));

        log.debug('POST %s => %j', req.path(), user);
        res.send(201, user);
        return next();
    });
}


function update(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    var params = parseParams(req);
    // I'd say we should do this at UFDS level but, while we don't make a
    // decission, let's go for it here (see CAPI-120):
    if (params.email && !EMAIL_RE.test(params.email)) {
        return next(new InvalidArgumentError('email: ' + params.email +
                ' is invalid'));
    }

    return ufds.getUser(req.params.login, id, function (err, user) {
        if (err) {
            return next(err);
        }
        return ufds.updateUser(user, params, id, function (er2) {
            if (er2) {
                return next(er2);
            }
            return ufds.getUser(req.params.login, id, function (er3, u) {
                if (er3) {
                    return next(er3);
                }
                u = translateUser(u);

                log.debug('POST %s => %j', req.path(), u);
                res.send(200, u);
                return next();
            });
        });
    });
}


function changePassword(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var errors = [];
    var params = {};

    if (req.params.password) {
        params.userpassword = req.params.password;
    } else {
        errors.push('password is required');
    }

    if (!req.params.password_confirmation) {
        errors.push('password_confirmation is required');
    }

    // Fail early:
    if (errors.length) {
        return next(new MissingParameterError(
                'Request is missing required parameters: ' +
                errors.join(', ')));
    }

    if (req.params.password !== req.params.password_confirmation) {
        return next(new InvalidArgumentError('password and ' +
                    'password_confirmation must have the same value'));
    }

    return ufds.getUser(req.params.login, id, function (err, user) {
        if (err) {
            return next(err);
        }
        return ufds.updateUser(user, params, id, function (er2) {
            if (er2) {
                return next(er2);
            }
            return ufds.getUser(req.params.login, id, function (er3, u) {
                if (er3) {
                    return next(er3);
                }
                u = translateUser(u);

                log.debug('POST %s => %j', req.path(), u);
                res.send(200, u);
                return next();
            });
        });
    });
}


function list(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;
    var dn = sprintf(USER_FMT, id);

    var opts = {
        scope: 'one',
        filter: '(objectclass=sdcaccountuser)'
    };

    return ufds.search(dn, opts, function (err, users) {
        if (err) {
            return next(err);
        }

        users = users.map(translateUser);
        log.debug('GET %s => %j', req.path(), users);
        res.send(users);
        return next();
    });
}


function get(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.getUser(req.params.login, id, function (err, user) {
        if (err) {
            return next(err);
        }

        return vasync.pipeline({
            funcs: [function mapGroups(_, cb) {
                if (!req.params.membership) {
                    return cb(null);
                }
                var roles = [];
                return user.roles(function (er2, rs) {
                    if (er2) {
                        return cb(er2);
                    }
                    roles = rs.map(function (r) {
                        return (r.name);
                    });
                    user.roles = roles;
                    return cb(null);
                });
            }
        ]
        }, function (error, results) {
            if (error) {
                return next(error);
            }
            user = translateUser(user);
            log.debug('GET %s => %j', req.path(), user);
            res.send(user);
            return next();
        });
    });
}


function del(req, res, next) {
    assert.ok(req.sdc);
    assert.ok(req.account);

    var log = req.log;
    var ufds = req.sdc.ufds_master;
    var id = req.account.uuid;

    return ufds.deleteUser(req.params.login, id, function (err) {
        if (err) {
            return next(err);
        }

        log.debug('DELETE %s -> ok', req.path());
        res.send(204);
        return next();
    });
}


function mount(server, before) {
    assert.argument(server, 'object', server);
    assert.ok(before);

    server.post({
        path: '/:account/users',
        name: 'CreateUser',
        contentType: [
            'multipart/form-data',
            'application/octet-stream',
            'application/json',
            'text/plain'
        ]
    }, before, create);

    server.get({
        path: '/:account/users',
        name: 'ListUsers'
    }, before, list);

    server.head({
        path: '/:account/users',
        name: 'HeadUsers'
    }, before, list);

    server.get({
        path: '/:account/users/:login',
        name: 'GetUser'
    }, before, get);

    server.head({
        path: '/:account/users/:login',
        name: 'HeadUser'
    }, before, get);

    server.post({
        path: '/:account/users/:login',
        name: 'UpdateUser'
    }, before, update);

    server.post({
        path: '/:account/users/:login/change_password',
        name: 'ChangeUserPassword'
    }, before, changePassword);

    server.del({
        path: '/:account/users/:login',
        name: 'DeleteUser'
    }, before, del);

    return server;
}


// --- API

module.exports = {
    mount: mount
};