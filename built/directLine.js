"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0)
            t[p[i]] = s[p[i]];
    return t;
};
var rxjs_1 = require("@reactivex/rxjs");
var BotConnection_1 = require("./BotConnection");
var Chat_1 = require("./Chat");
var intervalRefreshToken = 29 * 60 * 1000;
var timeout = 5 * 1000;
var DirectLine = (function () {
    function DirectLine(secretOrToken, domain, webSocket) {
        if (domain === void 0) { domain = "https://directline.botframework.com/v3/directline"; }
        if (webSocket === void 0) { webSocket = false; }
        this.domain = domain;
        this.webSocket = webSocket;
        this.connectionStatus$ = new rxjs_1.BehaviorSubject(BotConnection_1.ConnectionStatus.Connecting);
        this.watermark = '';
        this.secret = secretOrToken.secret;
        this.token = secretOrToken.secret || secretOrToken.token;
        this.activity$ = webSocket && WebSocket !== undefined
            ? this.webSocketActivity$()
            : this.pollingGetActivity$();
    }
    DirectLine.prototype.start = function () {
        var _this = this;
        this.conversationSubscription = this.startConversation()
            .subscribe(function (conversation) {
            _this.conversationId = conversation.conversationId;
            _this.token = _this.secret || conversation.token;
            _this.streamUrl = conversation.streamUrl;
            _this.connectionStatus$.next(BotConnection_1.ConnectionStatus.Online);
            if (!_this.secret)
                _this.refreshTokenLoop();
        });
    };
    DirectLine.prototype.startConversation = function () {
        var _this = this;
        return rxjs_1.Observable.ajax({
            method: "POST",
            url: this.domain + "/conversations",
            timeout: timeout,
            headers: {
                "Accept": "application/json",
                "Authorization": "Bearer " + this.token
            }
        })
            .map(function (ajaxResponse) { return ajaxResponse.response; })
            .retryWhen(function (error$) { return error$
            .mergeMap(function (error) {
            if (error.status >= 400 && error.status <= 599) {
                _this.connectionStatus$.next(BotConnection_1.ConnectionStatus.Offline);
                return rxjs_1.Observable.throw(error);
            }
            else {
                return rxjs_1.Observable.of(error);
            }
        })
            .delay(5 * 1000); });
    };
    DirectLine.prototype.refreshTokenLoop = function () {
        var _this = this;
        this.tokenRefreshSubscription = rxjs_1.Observable.interval(intervalRefreshToken)
            .flatMap(function (_) { return _this.refreshToken(); })
            .subscribe(function (token) {
            Chat_1.konsole.log("refreshing token", token, "at", new Date());
            _this.token = token;
        });
    };
    DirectLine.prototype.refreshToken = function () {
        var _this = this;
        return this.connectionStatus$
            .filter(function (connectionStatus) { return connectionStatus === BotConnection_1.ConnectionStatus.Online; })
            .flatMap(function (_) { return rxjs_1.Observable.ajax({
            method: "POST",
            url: _this.domain + "/tokens/refresh",
            timeout: timeout,
            headers: {
                "Authorization": "Bearer " + _this.token
            }
        }); })
            .map(function (ajaxResponse) { return ajaxResponse.response.token; })
            .retryWhen(function (error$) { return error$
            .mergeMap(function (error) {
            if (error.status === 403) {
                _this.connectionStatus$.next(BotConnection_1.ConnectionStatus.Offline);
                return rxjs_1.Observable.throw(error);
            }
            else {
                return rxjs_1.Observable.of(error);
            }
        })
            .delay(5 * 1000); });
    };
    DirectLine.prototype.end = function () {
        if (this.conversationSubscription) {
            this.conversationSubscription.unsubscribe();
            this.conversationSubscription = undefined;
        }
        if (this.tokenRefreshSubscription) {
            this.tokenRefreshSubscription.unsubscribe();
            this.tokenRefreshSubscription = undefined;
        }
        if (this.webSocketPingSubscription) {
            this.webSocketPingSubscription.unsubscribe();
            this.webSocketPingSubscription = undefined;
        }
    };
    DirectLine.prototype.postMessageWithAttachments = function (message) {
        var _this = this;
        var formData = new FormData();
        var attachments = message.attachments, newMessage = __rest(message, ["attachments"]);
        formData.append('activity', new Blob([JSON.stringify(newMessage)], { type: 'application/vnd.microsoft.activity' }));
        return this.connectionStatus$
            .filter(function (connectionStatus) { return connectionStatus === BotConnection_1.ConnectionStatus.Online; })
            .flatMap(function (_) {
            return rxjs_1.Observable.from(attachments || [])
                .flatMap(function (media) {
                return rxjs_1.Observable.ajax({
                    method: "GET",
                    url: media.contentUrl,
                    responseType: 'arraybuffer'
                })
                    .do(function (ajaxResponse) {
                    return formData.append('file', new Blob([ajaxResponse.response], { type: media.contentType }), media.name);
                });
            })
                .count();
        })
            .flatMap(function (_) {
            return rxjs_1.Observable.ajax({
                method: "POST",
                url: _this.domain + "/conversations/" + _this.conversationId + "/upload?userId=" + message.from.id,
                body: formData,
                timeout: timeout,
                headers: {
                    "Authorization": "Bearer " + _this.token
                }
            })
                .map(function (ajaxResponse) { return ajaxResponse.response.id; });
        })
            .catch(function (error) {
            Chat_1.konsole.log("postMessageWithAttachments error", error);
            return error.status >= 400 && error.status < 500
                ? rxjs_1.Observable.throw(error)
                : rxjs_1.Observable.of("retry");
        });
    };
    DirectLine.prototype.postActivity = function (activity) {
        var _this = this;
        return this.connectionStatus$
            .filter(function (connectionStatus) { return connectionStatus === BotConnection_1.ConnectionStatus.Online; })
            .flatMap(function (_) { return rxjs_1.Observable.ajax({
            method: "POST",
            url: _this.domain + "/conversations/" + _this.conversationId + "/activities",
            body: activity,
            timeout: timeout,
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + _this.token
            }
        }); })
            .map(function (ajaxResponse) { return ajaxResponse.response.id; })
            .catch(function (error) {
            return error.status >= 400 && error.status < 500
                ? rxjs_1.Observable.throw(error)
                : rxjs_1.Observable.of("retry");
        });
    };
    DirectLine.prototype.pollingGetActivity$ = function () {
        var _this = this;
        return this.connectionStatus$
            .filter(function (connectionStatus) { return connectionStatus === BotConnection_1.ConnectionStatus.Online; })
            .flatMap(function (_) { return rxjs_1.Observable.ajax({
            method: "GET",
            url: _this.domain + "/conversations/" + _this.conversationId + "/activities?watermark=" + _this.watermark,
            timeout: timeout,
            headers: {
                "Accept": "application/json",
                "Authorization": "Bearer " + _this.token
            }
        }); })
            .take(1)
            .map(function (ajaxResponse) { return ajaxResponse.response; })
            .flatMap(function (activityGroup) { return _this.observableFromActivityGroup(activityGroup); })
            .repeatWhen(function (completed) { return completed.delay(1000); })
            .retryWhen(function (error$) { return error$
            .mergeMap(function (error) {
            if (error.status === 403) {
                _this.connectionStatus$.next(BotConnection_1.ConnectionStatus.Offline);
                return rxjs_1.Observable.throw(error);
            }
            else {
                return rxjs_1.Observable.of(error);
            }
        })
            .delay(5 * 1000); });
    };
    DirectLine.prototype.observableFromActivityGroup = function (activityGroup) {
        if (activityGroup.watermark)
            this.watermark = activityGroup.watermark;
        return rxjs_1.Observable.from(activityGroup.activities);
    };
    DirectLine.prototype.webSocketURL$ = function () {
        var _this = this;
        return this.connectionStatus$
            .filter(function (connectionStatus) { return connectionStatus === BotConnection_1.ConnectionStatus.Online; })
            .flatMap(function (_) {
            if (_this.streamUrl) {
                var streamUrl = _this.streamUrl;
                _this.streamUrl = null;
                return rxjs_1.Observable.of(streamUrl);
            }
            else {
                return rxjs_1.Observable.ajax({
                    method: "GET",
                    url: _this.domain + "/conversations/" + _this.conversationId,
                    timeout: timeout,
                    headers: {
                        "Accept": "application/json",
                        "Authorization": "Bearer " + _this.token
                    }
                })
                    .map(function (result) { return result.response.streamUrl; });
            }
        })
            .retryWhen(function (error$) { return error$
            .mergeMap(function (error) {
            if (error.status === 403) {
                _this.connectionStatus$.next(BotConnection_1.ConnectionStatus.Offline);
                return rxjs_1.Observable.throw(error);
            }
            else {
                return rxjs_1.Observable.of(error);
            }
        })
            .delay(timeout); });
    };
    DirectLine.prototype.webSocketActivity$ = function () {
        var _this = this;
        // Chrome is pretty bad at noticing when a WebSocket connection is broken.
        // If we periodically ping the server with empty messages, it helps Chrome 
        // realize the connection is broken, and close the socket. This throws an
        // error, and that give us the opportunity to attempt to reconnect.
        this.webSocketPingSubscription = rxjs_1.Observable.interval(timeout).subscribe(function (_) {
            if (_this.wss)
                _this.wss.next({});
        });
        return this.webSocketURL$()
            .flatMap(function (url) {
            return _this.wss = rxjs_1.Observable.webSocket({ url: url,
                // Observable.webSocket runs JSON.parse() on all incoming messages, but DirectLine sends us empty WebSocket messages, 
                // which will crash JSON.parse(). This custom resultSelector avoids the problem.
                resultSelector: function (message) { return message.data && JSON.parse(message.data); }
            });
        })
            .retryWhen(function (error$) { return error$.delay(timeout); })
            .filter(function (activityGroup) { return !!activityGroup; })
            .flatMap(function (activityGroup) { return _this.observableFromActivityGroup(activityGroup); });
    };
    return DirectLine;
}());
exports.DirectLine = DirectLine;
//# sourceMappingURL=directLine.js.map