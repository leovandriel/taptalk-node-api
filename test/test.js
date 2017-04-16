const expect = require('chai').expect
const Api = require('../lib').Api

let api

beforeEach(() => {
    api = new Api()
})

describe('#deviceCreate', () => {
    it('works', () => {
        api.config.request = (params, callback) => {
            callback(null, null, JSON.stringify({ access_token: 'abc' }))
        }
        return api.deviceCreate().then(_ => {
            expect(api.state.access).to.equal('abc')
        })
    })
})
