'use strict'

const interact = require('@leonardvandriel/interact')

const config = {}
config.imports = {
    archiver: 'archiver',
    request: 'request',
    download: './lib/download',
    api: './lib/api',
}
config.historyFile = '.node_repl_history'
config.historyLength = 100
config.capturePromises = true
config.useColors = true

interact.start(config)
