const test = require('tape')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const HyperSim = require('..')

function noop () {}
test('simulated sockets', async t => {
  t.plan(4)
  try {
    const sim = new HyperSim({
      logger: line => console.error(JSON.stringify(line))
    })

    await sim.setup([
      {
        name: 'seed',
        count: 1,
        initFn ({ swarm, signal, name }, end) {
          let pending = 1

          swarm.join('topic', {
            lookup: false, // find & connect to peers
            announce: true // optional- announce self as a connection target
          })

          swarm.once('connection', (socket, details) => {
            socket.once('close', () => {
              // t.equal(detail.client, false, 'Initiating boolean available')
              if (!--pending) t.notOk(end(), 'Seed stream closed')
            })
            socket.once('data', chunk => {
              t.equal(chunk.toString(), 'hey seed', 'Leech msg received')
              socket.write('Yo leech!')
              // stream.end()
            })
          })
        }
      },
      {
        name: 'leech',
        count: 1,
        initFn ({ swarm, signal, name }, end) {
          swarm.join('topic', {
            lookup: true, // find & connect to peers
            announce: true // optional- announce self as a connection target
          })
          swarm.once('connection', (socket, details) => {
            socket.once('data', chunk => {
              t.equal(chunk.toString(), 'Yo leech!', 'Seed msg received')
              socket.destroy()
            })
            socket.once('close', () => {
              t.notOk(end(), 'Leech stream closed')
            })
            socket.write('hey seed')
          })
        }
      }
    ])

    await sim.run()
    t.end()
  } catch (err) { t.error(err) }
})

test.only('Basic hypercore simulation', t => {
  const { keyPair } = require('hypercore-crypto')
  const { publicKey, secretKey } = keyPair()
  const nLeeches = 1
  try {
    const simulation = new HyperSim({
      logger: line => console.error(JSON.stringify(line))
    })

    simulation.on('tick', sum => {
      // console.log(sum.rate)
    })
    simulation
      .setup([
        { name: 'seed', initFn: SimulatedPeer, count: 1, publicKey, secretKey },
        { name: 'leech', initFn: SimulatedPeer, count: nLeeches, publicKey }
      ])
      .then(() => simulation.run(0.1, 200))
      .then(() => console.log('Simulation finished'))
      .then(t.end)
      .catch(t.end)
  } catch (e) {
    t.end(e)
  }
  let pending = nLeeches
  function SimulatedPeer (opts, end) {
    const { storage, swarm, signal, id, name, publicKey, secretKey } = opts
    const feed = hypercore(ram, publicKey, { secretKey })

    function setupSwarm () {
      swarm.join(Buffer.from('mTopic'))

      swarm.once('connection', (socket, details) => {
        const protoStream = feed.replicate(details.client)

        socket.once('close', () => {
          if (name === 'leech') end()
          else if (!--pending) end()
        })

        socket.pipe(protoStream).pipe(socket)
      })
    }

    // setup content
    feed.ready(() => {
      if (name !== 'seed') {
        feed.on('append', seq => {
          signal('block', { seq: feed.length })
        })
        setupSwarm()
      } else {
        // Append some content to first feed.
        feed.append(Buffer.from(`N:${name},ID:${id}`), err => {
          signal('block0', { err })
          if (err) return end(err)
          feed.append(Buffer.from(`Hello ${Math.random()}`), err => {
            signal('block1', { err })
            if (err) return end(err)
            setupSwarm()
          })
        })
      }
    })
  }
})

/*
 * Debugging streamx-states, turns out that a writable.push(null)
 * manifests itself as the _final() callback. This of course
 * needed to be translated into a readable.push(null) when ducttaping
 * two duplex-streams together. Apologies for littering but i'm leaving
 * this here for future personal refernce:
 *
> protoStream._duplexState.toString(2).padStart(32,'0')
4333824
'00000000010000100010000100000000'
                   READ_DONE
> socket._duplexState.toString(2).padStart(32,'0')
13336848
'00000000110010111000000100010000'
                            Primary Read

> protoStream._duplexState
  .toString(2).split('').reverse().map((i,n) => parseInt(i) && n).filter(n => n)
[ 8,  // READ_PIPE_DRAINED
  13, // READ_DONE
  17, // WRITE_PRIMARY
  22  // WRITE_EMIT_DRAIN
]

> socket._duplexState.toString(2).split('').reverse().map((i,n) => parseInt(i) && n).filter(n => n)
[ 4, // READ_PRIMARY
  8, // READ_PIPE_DRAINED
  15,// READ_NEEDS_PUSH
  16,// WRITE_ACTIVE
  17,// WRITE_PRIMARY
  19,// WRITE_QUEUED
  22,// WRITE_EMIT_DRAIN
  23 // WRITE_NEXT_TICK (also assumes WRITE_ACTIVE)]

*/
