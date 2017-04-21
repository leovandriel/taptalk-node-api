'use strict'

module.exports = class {
    constructor(mode, api, provider, progress, state) {
        this.mode = mode
        this.api = api
        this.users = {}
        this.displaySet = new Set()
        this.displayForToken = {}
        this.pathSet = new Set()
        this.provider = provider
        this.state = state || {}
        this.progress = progress
        this.state.sum = 0
        this.meta = { tap: {}, user: {} }
    }

    streamFor(path, date) {
        if (path && !this.pathSet.has(path)) {
            this.pathSet.add(path)
            return this.provider(path, date)
        }
    }

    safeName(display_name) {
        const display = display_name
        .replace(/[\/:*?"<>|]+/g, ' ') // window/unix safe
        .replace(/[\[\]()^#%&!@:+={}'~`.]+/g, ' ') // cli safe
        .replace(/ +/g, ' ') // collapse space
        .replace(/ $/, '').replace(/^ /, '') // trim
        return display || 'someone'
    }

    uniqName(base, index) {
        const b = base + (index ? ` (${index})` : '')
        if (!this.displaySet.has(b)) {
            this.displaySet.add(b)
            return b
        }
        return this.uniqName(base, (index || 0) + 1)
    }

    displayUser(user) {
        const d = this.displayForToken[user.token]
        if (d) {
            return d
        }
        const n = this.uniqName(this.safeName(user.display_name))
        this.displayForToken[user.token] = n
        return n
    }

    readme() {
        return '' +
`
Welcome to the Tapstack (Taptalk) archiver.

- this archive contains ${this.state.sum} taps
- the "media" folder contains all images (jpeg) and videos (mpeg-4)
- the "profile" folder contains all profile images (jpeg)
- the "tap" folder contains the json description of every tap
- the "user" folder contains the json description of every user

Enjoy!
`
    }

    ensureMedium(subject, creator, name, medium, key, type, date, index) {
        const extension = {
            image: 'jpg',
            video: 'mp4',
            // overlay: 'png',
        }[type]
        const folder = {
            image: 'media',
            video: 'media',
            // overlay: 'overlay',
        }[type]
        const prefix = ('000' + index)
        const path = {
            all: `${folder}/${name}.${extension}`,
            tap: `${subject}/${prefix.substring(prefix.length - 4, prefix.length)} ${creator} ${new Date(date).toISOString().substring(0, 10)}.${extension}`,
        }[this.mode]
        const writable = this.streamFor(path, date)
        if (writable) {
            return Promise.resolve()
            .then(_ => this.api.downloadMedium(medium, key, writable))
            .then(_ => path)
            .catch(error => console.log('medium error', medium, error.message))
        }
    }

    ensureProfile(subject, token, profile, date) {
        const path = {
            all: `profile/${token}.jpg`,
            tap: `_/user/${subject}.jpg`,
        }[this.mode]
        const writable = this.streamFor(path, date)
        if (writable) {
            return Promise.resolve()
            .then(_ => this.api.downloadProfile(profile, writable))
            .then(_ => path)
            .catch(error => console.log('profile error', token, error.message))
        }
    }

    ensureUserInfo(tokens) {
        const filtered = tokens.filter(token => !this.users[token])
        return Promise.resolve(filtered.length && this.api.userShow(filtered)
        .then(users => {
            // console.log(`found users: ${users.map(user => user.display_name).join(', ')}      `)
            users.map(user => {
                this.users[user.token] = user
                const path = {
                    all: `user/${user.token}.json`
                }[this.mode]
                const writable = this.streamFor(path, Date.now())
                if (writable) {
                    writable.end(JSON.stringify(user, null, 2))
                }
                this.meta.user[user.token] = user
                const date = Date.parse(user.first_saved_at || user.last_seen) || Date.now()
                return Promise.resolve()
                .then(_ => this.ensureProfile(this.displayUser(user), user.token, user.image_token, date))
                .then(path => this.meta.user[user.token].image_path = path)
            })
        }))
    }

    userInfo(token) {
        const user = this.users[token]
        return Promise.resolve(user || this.ensureUserInfo([token]).then(_ => this.users[token]))
    }

    displayTap(tap) {
        const creator_token = (tap.receiver.token === this.state.api_user ? tap.sender.token : tap.receiver.token)
        const subject_token = (tap.group && tap.group.token) || creator_token
        return Promise.all([this.userInfo(subject_token), this.userInfo(creator_token)])
        .then(pair => pair.map(user => this.displayUser(user)))
    }

    saveTap(tap, subject, creator, index) {
        const path = {
            all: `tap/${tap.token}.json`
        }[this.mode]
        const writable = this.streamFor(path, Date.now())
        if (writable) {
            writable.end(JSON.stringify(tap, null, 2))
        }
        this.meta.tap[tap.token] = tap
        const p = []
        const date = Date.parse(tap.time) || Date.now()
        if (tap.image) {
            p.push(Promise.resolve()
                .then(_ => this.ensureMedium(subject, creator, tap.token, tap.image, tap.key, 'image', date, index))
                .then(path => this.meta.tap[tap.token].image_path = path)
            )
        }
        if (tap.video) {
            p.push(Promise.resolve()
                .then(_ => this.ensureMedium(subject, creator, tap.token, tap.video, tap.key, 'video', date, index))
                .then(path => this.meta.tap[tap.token].video_path = path)
            )
        }
        if (tap.overlay) {
            p.push(Promise.resolve()
                .then(_ => this.ensureMedium(subject, creator, tap.token, tap.overlay, tap.key, 'overlay', date, index))
                .then(path => this.meta.tap[tap.token].overlay_ath = path)
            )
        }
        return Promise.all(p)
    }

    downloadTaps(taps) {
        let c = 0
        const tokens = new Set()
        taps.forEach(tap => {
            if (tap.sender.token) {
                tokens.add(tap.sender.token)
            }
            if (tap.receiver.token) {
                tokens.add(tap.receiver.token)
            }
            if (tap.group && tap.group.token) {
                tokens.add(tap.group.token)
            }
            if (tap.save_user_tokens) {
                tap.save_user_tokens.forEach(token => tokens.add(token))
            }
        })
        return Promise.resolve()
        .then(_ => this.ensureUserInfo(Array.from(tokens)))
        .then(_ => Promise.all(taps.map((tap, index) =>
            Promise.resolve()
            .then(_ => this.displayTap(tap))
            .then(pair => this.saveTap(tap, pair[0], pair[1], this.state.sum + index))
        )))
    }

    iterateTaps(count, limit) {
        return Promise.resolve(count === 0 || this.api.memoryList(this.state.start, limit).then(body => {
            const taps = body.items
            return taps.length && this.downloadTaps(taps)
            .then(_ => {
                this.state.start = body.next
                this.state.sum = (this.state.sum || 0) + taps.length
                this.progress(this.state.sum)
            })
            .then(_ => this.iterateTaps(count - 1, limit, true))
        }))
    }

    download(count, limit) {
        return this.iterateTaps(count || -1, limit || 50) // to just fetch a couple of pages: replace -1 with page count
        .then(_ => this.meta)
    }
}
