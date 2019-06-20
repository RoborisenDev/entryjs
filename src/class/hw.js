﻿/**
 * @fileoverview HW object class for connect arduino.
 */
'use strict';

require('../playground/blocks');

Entry.HW = class HW {
    constructor() {
        this.sessionRoomId = localStorage.getItem('entryhwRoomId');
        if (!this.sessionRoomId) {
            this.sessionRoomId = this.createRandomRoomId();
            localStorage.setItem('entryhwRoomId', this.sessionRoomId);
        }

        this.connectTrial = 0;
        this.isFirstConnect = true;
        this.connected = false;
        this.portData = {};
        this.sendQueue = {};
        this.outputQueue = {};
        this.settingQueue = {};
        this.selectedDevice = null;
        this.hwModule = null;
        this.socketType = null;

        const { options = {} } = Entry;
        const { disableHardware = false } = options;

        this.hwPopupCreate();
        !disableHardware && this.initSocket();
        Entry.addEventListener('stop', this.setZero);

        this.hwInfo = Entry.HARDWARE_LIST;
    }

    static TRIAL_LIMIT = 2;

    createRandomRoomId = function() {
        return 'xxxxxxxxyx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c == 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    };

    connectWebSocket = function(url, option) {
        const hw = this;
        const socket = io(url, option);
        socket.io.reconnectionAttempts(Entry.HW.TRIAL_LIMIT);
        socket.io.reconnectionDelayMax(1000);
        socket.io.timeout(1000);
        socket.on('connect', () => {
            hw.socketType = 'WebSocket';
            hw.initHardware(socket);
        });

        socket.on('mode', (mode) => {
            if (socket.mode === 0 && mode === 1) {
                hw.disconnectHardware();
            }
            hw.socketMode = mode;
            socket.mode = mode;
        });

        socket.on('message', ({ data, version }) => {
            if (data) {
                let portData = {};
                if (typeof data === 'string') {
                    switch (data) {
                        case 'disconnectHardware': {
                            hw.disconnectHardware();
                            return;
                            break;
                        }
                        default: {
                            portData = JSON.parse(data);
                            break;
                        }
                    }
                } else if (_.isObject(data)) {
                    portData = data;
                }
                hw.checkDevice(portData, version);
                hw.updatePortData(portData);
            }
        });

        socket.on('disconnect', () => {
            hw.initSocket();
        });

        return socket;
    };

    initSocket = function() {
        try {
            const hw = this;
            const protocol = '';
            this.connected = false;

            if (this.tlsSocketIo1) {
                this.tlsSocketIo1.removeAllListeners();
            }
            if (this.tlsSocketIo2) {
                this.tlsSocketIo2.removeAllListeners();
            }
            if (this.socketIo) {
                this.socketIo.removeAllListeners();
            }

            if (!this.isOpenHardware) {
                this.checkOldClient();
            }
            if (location.protocol.indexOf('https') > -1) {
                try {
                    this.tlsSocketIo1 = this.connectWebSocket(
                        'https://hardware.playentry.org:23518',
                        { query: { client: true, roomId: this.sessionRoomId } }
                    );
                } catch (e) {}
                try {
                    this.tlsSocketIo2 = this.connectWebSocket(
                        'https://hardware.play-entry.org:23518',
                        { query: { client: true, roomId: this.sessionRoomId } }
                    );
                } catch (e) {}
            } else {
                try {
                    this.socketIo = this.connectWebSocket('http://127.0.0.1:23518', {
                        query: { client: true, roomId: this.sessionRoomId },
                    });
                } catch (e) {}
                try {
                    this.tlsSocketIo1 = this.connectWebSocket(
                        'https://hardware.playentry.org:23518',
                        { query: { client: true, roomId: this.sessionRoomId } }
                    );
                } catch (e) {}
                try {
                    this.tlsSocketIo2 = this.connectWebSocket(
                        'https://hardware.play-entry.org:23518',
                        { query: { client: true, roomId: this.sessionRoomId } }
                    );
                } catch (e) {}
            }

            Entry.dispatchEvent('hwChanged');
        } catch (e) {}
    };

    checkOldClient = function() {
        try {
            const hw = this;
            const websocket = new WebSocket('wss://hardware.play-entry.org:23518');
            websocket.onopen = function() {
                hw.popupHelper.show('newVersion', true);
                websocket.close();
            };
        } catch (e) {}
    };

    retryConnect = function() {
        this.isOpenHardware = false;
        Entry.HW.TRIAL_LIMIT = 5;
        this.initSocket();
    };

    openHardwareProgram = function() {
        const hw = this;
        this.isOpenHardware = true;
        Entry.HW.TRIAL_LIMIT = 5;
        this.executeHardware();

        if (!this.socket || !this.socket.connected) {
            setTimeout(() => {
                hw.initSocket();
            }, 1000);
        }
    };

    initHardware = function(socket) {
        this.socket = socket;
        this.connectTrial = 0;
        this.connected = true;
        Entry.dispatchEvent('hwChanged');
        if (Entry.playground && Entry.playground.object) {
            Entry.playground.setMenu(Entry.playground.object.objectType);
        }
    };

    disconnectHardware = function() {
        Entry.propertyPanel && Entry.propertyPanel.removeMode('hw');
        this.selectedDevice = undefined;
        this.hwModule = undefined;
        Entry.dispatchEvent('hwChanged');
    };

    disconnectedSocket = function() {
        this.tlsSocketIo1 && this.tlsSocketIo1.close();
        this.tlsSocketIo2 && this.tlsSocketIo2.close();
        this.socketIo && this.socketIo.close();

        Entry.propertyPanel && Entry.propertyPanel.removeMode('hw');
        this.socket = undefined;
        this.connectTrial = 0;
        this.connected = false;
        this.selectedDevice = undefined;
        this.hwModule = undefined;
        Entry.dispatchEvent('hwChanged');
        Entry.toast.alert(
            '하드웨어 프로그램 연결 종료',
            '하드웨어 프로그램과의 연결이 종료되었습니다.',
            false
        );
    };

    setDigitalPortValue = function(port, value) {
        this.sendQueue[port] = value;
        this.removePortReadable(port);
    };

    getAnalogPortValue = function(port) {
        if (!this.connected) {
            return 0;
        }
        return this.portData[`a${port}`];
    };

    getDigitalPortValue = function(port) {
        if (!this.connected) {
            return 0;
        }
        this.setPortReadable(port);
        if (this.portData[port] !== undefined) {
            return this.portData[port];
        } else {
            return 0;
        }
    };

    setPortReadable = function(port) {
        if (!this.sendQueue.readablePorts) {
            this.sendQueue.readablePorts = [];
        }

        let isPass = false;
        for (const i in this.sendQueue.readablePorts) {
            if (this.sendQueue.readablePorts[i] == port) {
                isPass = true;
                break;
            }
        }

        if (!isPass) {
            this.sendQueue.readablePorts.push(port);
        }
    };
    removePortReadable = function(port) {
        if (!this.sendQueue.readablePorts && !Array.isArray(this.sendQueue.readablePorts)) {
            return;
        }
        let target;
        for (const i in this.sendQueue.readablePorts) {
            if (this.sendQueue.readablePorts[i] == port) {
                target = Number(i);
                break;
            }
        }

        if (target != undefined) {
            this.sendQueue.readablePorts = this.sendQueue.readablePorts
                .slice(0, target)
                .concat(
                    this.sendQueue.readablePorts.slice(
                        target + 1,
                        this.sendQueue.readablePorts.length
                    )
                );
        }
    };

    update = function() {
        if (!this.socket) {
            return;
        }
        if (this.socket.disconnected) {
            return;
        }
        if (this.hwModule && this.hwModule.sendMessage) {
            this.hwModule.sendMessage(this);
        } else {
            this.socket.emit('message', {
                data: JSON.stringify(this.sendQueue),
                mode: this.socket.mode,
                type: 'utf8',
            });
        }
    };

    updatePortData = function(data) {
        this.portData = data;
        if (this.hwMonitor && Entry.propertyPanel && Entry.propertyPanel.selected == 'hw') {
            this.hwMonitor.update();
        }
        if (this.hwModule && this.hwModule.afterReceive) {
            this.hwModule.afterReceive(this.portData);
        }
    };

    closeConnection = function() {
        if (this.socket) {
            this.socket.close();
        }
    };

    downloadConnector = function() {
        Entry.dispatchEvent('hwDownload', 'hardware');
    };

    downloadGuide = function() {
        Entry.dispatchEvent('hwDownload', 'manual');
        // var url = "http://download.play-entry.org/data/hardware_manual.zip";
        // window.open(url, 'download');
    };

    downloadSource = function() {
        Entry.dispatchEvent('hwDownload', 'ino');
        // var url = "http://play-entry.com/down/board.ino";
        // var win = window.open(url, '_blank');
        // win.focus();
    };

    setZero = function() {
        if (!Entry.hw.hwModule) {
            return;
        }
        Entry.hw.hwModule.setZero();
    };

    checkDevice = function(data, version) {
        if (data.company === undefined) {
            return;
        }
        const key = [
            Entry.Utils.convertIntToHex(data.company),
            '.',
            Entry.Utils.convertIntToHex(data.model),
        ].join('');
        if (key == this.selectedDevice) {
            if (this.hwModule && this.hwModule.dataHandler) {
                this.hwModule.dataHandler(data);
            }
            return;
        }

        this.selectedDevice = key;
        this.hwModule = this.hwInfo[key];
        if (!this.hwModule) {
            return;
        }
        Entry.dispatchEvent('hwChanged');

        let descMsg = '';
        if (Entry.propertyPanel && this.hwModule.monitorTemplate) {
            descMsg = Lang.Msgs.hw_connection_success_desc;
            if (!this.hwMonitor) {
                this.hwMonitor = new Entry.HWMonitor(this.hwModule);
            } else {
                this.hwMonitor._hwModule = this.hwModule;
                this.hwMonitor.initView();
            }
            Entry.propertyPanel.addMode('hw', this.hwMonitor);
            const mt = this.hwModule.monitorTemplate;
            if (mt.mode == 'both') {
                mt.mode = 'list';
                this.hwMonitor.generateListView();
                mt.mode = 'general';
                this.hwMonitor.generateView();
                mt.mode = 'both';
            } else if (mt.mode == 'list') {
                this.hwMonitor.generateListView();
            } else {
                this.hwMonitor.generateView();
            }
        } else {
            descMsg = Lang.Msgs.hw_connection_success_desc2;
        }
        Entry.toast.success(Lang.Msgs.hw_connection_success, descMsg);
    };

    banHW = function() {
        for (const i in this.hwInfo) {
            const hwModule = this.hwInfo[i];
            if (!hwModule) {
                continue;
            }
            Entry.playground.mainWorkspace.blockMenu.banClass(hwModule.name, true);
        }
    };

    executeHardware = function() {
        const hw = this;
        var executeIeCustomLauncher = {
            _bNotInstalled: false,
            init(sUrl, fpCallback) {
                const width = 220;
                const height = 225;
                const left = window.screenLeft;
                const top = window.screenTop;
                const settings = `width=${width}, height=${height},  top=${top}, left=${left}`;
                this._w = window.open('/views/hwLoading.html', 'entry_hw_launcher', settings);
                let fnInterval = null;
                fnInterval = setTimeout(() => {
                    executeIeCustomLauncher.runViewer(sUrl, fpCallback);
                    clearInterval(fnInterval);
                }, 1000);
            },
            runViewer(sUrl, fpCallback) {
                this._w.document.write(
                    `<iframe src='${sUrl}' onload='opener.Entry.hw.ieLauncher.set()' style='display:none;width:0;height:0'></iframe>`
                );
                let nCounter = 0;
                const bNotInstalled = false;
                let nInterval = null;
                nInterval = setInterval(() => {
                    try {
                        this._w.location.href;
                    } catch (e) {
                        this._bNotInstalled = true;
                    }

                    if (bNotInstalled || nCounter > 10) {
                        clearInterval(nInterval);
                        let nCloseCounter = 0;
                        let nCloseInterval = null;
                        nCloseInterval = setInterval(() => {
                            nCloseCounter++;
                            if (this._w.closed || nCloseCounter > 2) {
                                clearInterval(nCloseInterval);
                            } else {
                                this._w.close();
                            }
                            this._bNotInstalled = false;
                            nCounter = 0;
                        }, 5000);
                        fpCallback(!this._bNotInstalled);
                    }
                    nCounter++;
                }, 100);
            },
            set() {
                this._bNotInstalled = true;
            },
        };

        hw.ieLauncher = executeIeCustomLauncher;

        const entryHardwareUrl = `entryhw://-roomId:${this.sessionRoomId}`;
        if (navigator.userAgent.indexOf('MSIE') > 0 || navigator.userAgent.indexOf('Trident') > 0) {
            if (navigator.msLaunchUri != undefined) {
                executeIe(entryHardwareUrl);
            } else {
                let ieVersion;
                if (document.documentMode > 0) {
                    ieVersion = document.documentMode;
                } else {
                    ieVersion = navigator.userAgent.match(/(?:MSIE) ([0-9.]+)/)[1];
                }

                if (ieVersion < 9) {
                    alert(Lang.msgs.not_support_browser);
                } else {
                    executeIeCustomLauncher.init(entryHardwareUrl, (bInstalled) => {
                        if (bInstalled == false) {
                            hw.openHardwareDownloadPopup();
                        }
                    });
                }
            }
        } else if (navigator.userAgent.indexOf('Firefox') > 0) {
            executeFirefox(entryHardwareUrl);
        } else if (
            navigator.userAgent.indexOf('Chrome') > 0 ||
            navigator.userAgent.indexOf('Safari') > 0
        ) {
            executeChrome(entryHardwareUrl);
        } else {
            alert(Lang.msgs.not_support_browser);
        }

        function executeIe(customUrl) {
            navigator.msLaunchUri(
                customUrl,
                () => {},
                () => {
                    hw.openHardwareDownloadPopup();
                }
            );
        }

        function executeFirefox(customUrl) {
            const iFrame = document.createElement('iframe');
            iFrame.src = 'about:blank';
            iFrame.style = 'display:none';
            document.getElementsByTagName('body')[0].appendChild(iFrame);
            let fnTimeout = null;
            fnTimeout = setTimeout(() => {
                let isInstalled = false;
                try {
                    iFrame.contentWindow.location.href = customUrl;
                    isInstalled = true;
                } catch (e) {
                    if (e.name == 'NS_ERROR_UNKNOWN_PROTOCOL') {
                        isInstalled = false;
                    }
                }

                if (!isInstalled) {
                    hw.openHardwareDownloadPopup();
                }

                document.getElementsByTagName('body')[0].removeChild(iFrame);
                clearTimeout(fnTimeout);
            }, 500);
        }

        function executeChrome(customUrl) {
            let isInstalled = false;
            window.focus();
            $(window).one('blur', () => {
                isInstalled = true;
            });
            Entry.dispatchEvent('workspaceUnbindUnload', true);
            location.assign(encodeURI(customUrl));
            setTimeout(() => {
                Entry.dispatchEvent('workspaceBindUnload', true);
            }, 100);
            setTimeout(() => {
                if (isInstalled == false) {
                    hw.openHardwareDownloadPopup();
                }
                window.onblur = null;
            }, 3000);
        }
    };

    openHardwareDownloadPopup = function() {
        if (Entry.events_.openHardWareDownloadModal) {
            Entry.dispatchEvent('openHardWareDownloadModal');
        } else {
            Entry.hw.popupHelper.show('hwDownload', true);
        }
    };

    hwPopupCreate = function() {
        const hw = this;
        if (!this.popupHelper) {
            if (window.popupHelper) {
                this.popupHelper = window.popupHelper;
            } else {
                this.popupHelper = new Entry.PopupHelper(true);
            }
        }

        this.popupHelper.addPopup('newVersion', {
            type: 'confirm',
            title: Lang.Msgs.new_version_title,
            setPopupLayout(popup) {
                const content = Entry.Dom('div', {
                    class: 'contentArea',
                });
                const text = Entry.Dom('div', {
                    class: 'textArea',
                    parent: content,
                });
                const text1 = Entry.Dom('div', {
                    class: 'text1',
                    parent: text,
                });
                const text2 = Entry.Dom('div', {
                    class: 'text2',
                    parent: text,
                });
                const text3 = Entry.Dom('div', {
                    class: 'text3',
                    parent: text,
                });
                const text4 = Entry.Dom('div', {
                    class: 'text4',
                    parent: text,
                });
                const cancel = Entry.Dom('div', {
                    classes: ['popupCancelBtn', 'popupDefaultBtn'],
                    parent: content,
                });
                const ok = Entry.Dom('div', {
                    classes: ['popupOkBtn', 'popupDefaultBtn'],
                    parent: content,
                });
                text1.text(Lang.Msgs.new_version_text1);
                text2.html(Lang.Msgs.new_version_text2);
                text3.text(Lang.Msgs.new_version_text3);
                text4.text(Lang.Msgs.new_version_text4);
                cancel.text(Lang.Buttons.cancel);
                ok.html(Lang.Msgs.new_version_download);

                content.bindOnClick('.popupDefaultBtn', function(e) {
                    const $this = $(this);
                    if ($this.hasClass('popupOkBtn')) {
                        hw.downloadConnector();
                    }

                    hw.popupHelper.hide('newVersion');
                });

                popup.append(content);
            },
        });

        this.popupHelper.addPopup('hwDownload', {
            type: 'confirm',
            title: Lang.Msgs.not_install_title,
            setPopupLayout(popup) {
                const content = Entry.Dom('div', {
                    class: 'contentArea',
                });
                const text = Entry.Dom('div', {
                    class: 'textArea',
                    parent: content,
                });
                const text1 = Entry.Dom('div', {
                    class: 'text1',
                    parent: text,
                });
                const text2 = Entry.Dom('div', {
                    class: 'text2',
                    parent: text,
                });
                const text3 = Entry.Dom('div', {
                    class: 'text3',
                    parent: text,
                });
                const text4 = Entry.Dom('div', {
                    class: 'text4',
                    parent: text,
                });
                const cancel = Entry.Dom('div', {
                    classes: ['popupCancelBtn', 'popupDefaultBtn'],
                    parent: content,
                });
                const ok = Entry.Dom('div', {
                    classes: ['popupOkBtn', 'popupDefaultBtn'],
                    parent: content,
                });
                text1.text(Lang.Msgs.hw_download_text1);
                text2.html(Lang.Msgs.hw_download_text2);
                text3.text(Lang.Msgs.hw_download_text3);
                text4.text(Lang.Msgs.hw_download_text4);
                cancel.text(Lang.Buttons.cancel);
                ok.html(Lang.Msgs.hw_download_btn);

                content.bindOnClick('.popupDefaultBtn', function(e) {
                    const $this = $(this);
                    if ($this.hasClass('popupOkBtn')) {
                        hw.downloadConnector();
                    }

                    hw.popupHelper.hide('hwDownload');
                });

                popup.append(content);
            },
        });
    };
};