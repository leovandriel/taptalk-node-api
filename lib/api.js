
const stream = require('stream')
const crypto = require('crypto')

class Decryptor extends stream.Transform {
    constructor(key) {
        super()
        this.key = key
    }

    _transform(chunk, encoding, callback) {
        if (this.decipher) {
            return this.update(chunk, encoding, callback)
        }
        if (!chunk || chunk.length < 18) {
            return callback(new Error('too small'))
        }
        if (!this.key || this.key.length !== 44) {
            return callback(new Error('bad key'))
        }
        const keyBuffer = new Buffer(this.key, 'base64').slice(0, 32)
        const ivBuffer = chunk.slice(2, 18)
        this.decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, ivBuffer)
        this.update(chunk.slice(18), encoding, callback)
    }

    _flush(callback) {
        this.update(null, null, callback)
    }

    update(chunk, encoding, callback) {
        let out = null
        try {
            out = chunk ? this.decipher.update(chunk, encoding) : this.decipher.final()
        } catch (error) {
            return callback(error)
        }
        this.push(out)
        callback()
    }
}

module.exports = class {
    constructor(request, state) {
        this.config = this.defaultConfig(request)
        this.state = state || {}
    }

    defaultConfig(request) {
        return {
            host: 'https://api.tapstack.com',
            accept: 'application/vnd.chocodile.v1',
            agent: 'Tapstack/0.58b347 iOS/10.3 x/86.64',
            auth: 'Chocodile',
            app: 's2edWnChBV0W6BAu',
            source: 'local',
            media: 'https://yellow-cow.s3.amazonaws.com',
            request: request || (_ => new Error('set api.config.request = params => {..}'))
        }
    }

    reset() {
        this.state = {}
    }

    get signedIn() {
        return this.state.access && this.state.user
    }

    // Request

    rest(path, form, auth) {
        const params = {
            url: `${this.config.host}${path}`,
            headers: { 'Accept': this.config.accept }
        }
        if (form) {
            params.form = form
            params.method = 'POST'
        }
        if (auth) {
            params.headers['Authorization'] = `${this.config.auth} ${auth}`
        }
        return new Promise((resolve, reject) => {
            return this.config.request(params, (err, response, json) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(JSON.parse(json))
                }
            })
        })
    }

    image(type, medium, reject) {
        const params = {
            url: `${this.config.media}/${type}/${medium}`
        }
        return this.config.request(params, (error, response, json) => error && reject(error))
    }

    // Endpoints

    deviceCreate() {
        const form = {
            app_source: this.config.source,
            app_token: this.config.app,
            user_agent: this.config.agent,
        }
        return this.rest('/device/create', form)
        .then(body => {
            if (body.access_token) {
                this.state.access = body.access_token
            }
        })
    }

    accountSendPhoneVerification(phone) {
        if (!this.state.access) throw new Error('deviceCreate required')
        if (!phone) throw new Error('phone number required')
        return this.rest('/account/send_phone_verification', { phone }, this.state.access)
        .then(body => {
            if (body.secret) {
                this.state.phone = phone
                this.state.secret = body.secret
            }
        })
    }

    accountVerifyPhone(code) {
        if (!this.state.access) throw new Error('deviceCreate required')
        if (!this.state.secret) throw new Error('accountSendPhoneVerification required')
        if (!this.state.phone) throw new Error('phone number required')
        if (!code) throw new Error('sms code required')
        const form = {
            phone: this.state.phone,
            verification_code: code,
            verification_secret: this.state.secret,
        }
        return this.rest('/account/verify_phone', form, this.state.access)
        .then(body => {
            if (body.signed_phone) {
                this.state.signed = body.signed_phone
            }
        })
    }

    accountSignIn() {
        if (!this.state.access) throw new Error('deviceCreate required')
        if (!this.state.signed) throw new Error('accountVerifyPhone required')
        const form = {
            signed_phone: this.state.signed,
        }
        return this.rest('/account/sign_in', form, this.state.access)
        .then(body => {
            if (body.user_token) {
                this.state.user = body.user_token
                this.state.display = body.display_name
                this.state.memory = body.memory_count
            }
        })
    }

    userShow(tokens) {
        const query = tokens.slice(0, 50).map(token => `user_token[]=${token}`).join('&')
        return this.rest(`/friends/show?${query}`, null, this.state.access)
        .then(body => body.users)
    }

    memoryList(start, limit) {
        if (!this.state.access) throw new Error('deviceCreate required')
        if (!this.state.user) throw new Error('accountSignIn required')
        const path = `/pins/list?type=memory&page_limit=${limit || 50}&page_order=time&page_start=${start || ''}`
        return this.rest(path, null, this.state.access)
        .then(body => {
            return { items: body.pins, next: body.next_page_start }
        })
    }

    // Media

    downloadMedium(medium, key, writable) {
        return new Promise((resolve, reject) => {
            writable.on('end', resolve)
            writable.on('error', reject)
            const decryptor = new Decryptor(key)
            const decrypted = this.image('media', medium, reject).pipe(decryptor)
            decryptor.on('error', error => {
                decrypted.unpipe()
                writable.end()
                reject(error)
            })
            decrypted.pipe(writable)
        })
    }

    downloadProfile(profile, writable) {
        return new Promise((resolve, reject) => {
            writable.on('end', resolve)
            writable.on('error', reject)
            this.image('profile', profile, reject).pipe(writable)
        })
    }
}
