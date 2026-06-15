(function() {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        let url = "";
        if (typeof args[0] === "string") url = args[0];
        else if (args[0] && typeof args[0] === 'object' && args[0].url) url = args[0].url;
        
        if (url && url.match(/betting\/fo\/bets/i)) {
            let extractedHeaders = {};
            const extractFrom = (source) => {
                if (!source) return;
                if (source instanceof Headers) {
                    for (let [k, v] of source.entries()) extractedHeaders[k] = v;
                } else if (typeof source === 'object') {
                    for (let k in source) {
                        if (Object.prototype.hasOwnProperty.call(source, k)) {
                            extractedHeaders[k] = source[k];
                        }
                    }
                }
            };
            try {
                if (args[0] && typeof args[0] === 'object' && args[0].headers) extractFrom(args[0].headers);
                if (args[1] && args[1].headers) extractFrom(args[1].headers);
            } catch(e) {}
            
            window.postMessage({
                type: 'SLB_API_CAUGHT_MAIN',
                headers: extractedHeaders,
                baseUrl: url.split('?')[0]
            }, '*');
        }
        return originalFetch.apply(this, args);
    };

    const originalXHRSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function(body) {
        if (this._url && this._url.match(/betting\/fo\/bets/i)) {
            try {
                window.postMessage({
                    type: 'SLB_API_CAUGHT_MAIN',
                    headers: this._requestHeaders || {},
                    baseUrl: this._url.split('?')[0]
                }, '*');
            } catch(e) {}
        }
        return originalXHRSend.apply(this, arguments);
    };
    
    const originalXHROpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this._requestHeaders = {};
        return originalXHROpen.apply(this, arguments);
    };

    const originalXHRSetRequestHeader = window.XMLHttpRequest.prototype.setRequestHeader;
    window.XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (this._requestHeaders) this._requestHeaders[header] = value;
        return originalXHRSetRequestHeader.apply(this, arguments);
    };
})();
