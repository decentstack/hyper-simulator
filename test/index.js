const test = require('tape')
const hypercore = require('hypercore')
const HyperSim = require('..')

let redKey = null
let blueKey = null

test('simulated sockets', async t => {
  try {
    const sim = new HyperSim()
    await sim.setup([
      {
        name: 'seed',
        count: 1,
        initFn ({ swarm, signal, name }, end) {
          let pending = 1
          swarm.join('topic', ({ stream, initiating, leave }) => {
            stream.once('data', chunk => {
              t.equal(chunk.toString(), 'hey seed', 'Leech msg received')
              stream.write('Yo leech!')
              if (!--pending) end()
            })
          })
        }
      },
      {
        name: 'leech',
        count: 1,
        initFn ({ swarm, signal, name }, end) {
          swarm.join('topic', ({ stream, initiating, leave }) => {
            stream.once('data', chunk => {
              t.equal(chunk.toString(), 'Yo leech!', 'Seed msg received')
              end()
            })
            stream.write('hey seed')
          })
        }
      }
    ])

    await sim.run()
    t.end()
  } catch (err) { t.error(err) }
})
test.skip('Basic hypercore simulation', t => {
  try {
    const simulation = new HyperSim()
    simulation
      .setup([
        { name: 'red', initFn: SimulatedPeer, count: 4, firewalled: 0.7 },
        { name: 'blue', initFn: SimulatedPeer, count: 0, receivers: 0.9 }
      ])
      .then(() => simulation.run())
      .then(() => console.log('Simulation finished'))
      .then(t.end)
      .catch(t.end)
  } catch (e) {
    t.end(e)
  }
})

function SimulatedPeer ({ storage, swarm, signal, id, name }, end) {
  const feed = hypercore(storage, name === 'red' ? redKey : blueKey)

  function validateEnd () {
    debugger
    feed.close(end)
  }

  function setupSwarm () {
    const leave = swarm.join(Buffer.from('mTopic'), ({ stream, initiating, leave }) => {
      const protoStream = feed.replicate(initiating)
      stream.pipe(protoStream).pipe(stream)
      stream.once('finish', validateEnd)
    })

    feed.on('download', seq => {
      signal('block', { seq: feed.length })
      if (feed.length >= 2) {
        leave()
      }
    })
  }

  // setup content
  feed.ready(() => {
    if (name === 'red' && !redKey) {
      redKey = feed.key
      signal('red-key', { key: redKey.toString('hex') })
    }
    if (name === 'blue' && !blueKey) {
      blueKey = feed.key
      signal('blue-key', { key: blueKey.toString('hex') })
    }

    // Only generate content in first feed.
    if (id !== 1 || !feed.length) {
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
