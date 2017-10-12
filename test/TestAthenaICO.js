function ether(n) {
  return new web3.BigNumber(web3.toWei(n, 'ether'))
}

function finney(n) {
  return new web3.BigNumber(web3.toWei(n, 'finney'))
}

function latestTime() {
  return web3.eth.getBlock('latest').timestamp;
}

function advanceBlock() {
  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: Date.now(),
    }, (err, res) => {
      return err ? reject(err) : resolve(res)
    })
  })
}

const duration = {
  seconds: function(val) { return val},
  minutes: function(val) { return val * this.seconds(60) },
  hours:   function(val) { return val * this.minutes(60) },
  days:    function(val) { return val * this.hours(24) },
  weeks:   function(val) { return val * this.days(7) },
  years:   function(val) { return val * this.days(365)}
};

function increaseTime(duration) {
  const id = Date.now()

  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [duration],
      id: id,
    }, err1 => {
      if (err1) return reject(err1)

      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_mine',
        id: id+1,
      }, (err2, res) => {
        return err2 ? reject(err2) : resolve(res)
      })
    })
  })
}

function increaseTimeTo(target) {
  let now = latestTime();
  if (target < now) throw Error(`Cannot increase current time(${now}) to a moment in the past(${target})`);
  let diff = target - now;
  return increaseTime(diff);
}

var EVMThrow = 'invalid opcode'

const BigNumber = web3.BigNumber

const should = require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should()

const AthenaLabsICO = artifacts.require('AthenaLabsICO');
const AthenaLabsToken = artifacts.require('AthenaLabsToken');


contract('AthenaLabsICO', function ([_, admin, wallet, investor, reader, owner]) {

  before(async function() {
    //Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
    await advanceBlock()
  })

  beforeEach(async function () {
    this.startTime = latestTime() + duration.weeks(1);
    this.round1End = this.startTime + duration.days(3);
    this.round2End = this.round1End + duration.days(4);
    this.round3End = this.round2End + duration.days(5);
    this.round4End = this.round3End + duration.days(6);
    this.round5End = this.round4End + duration.days(7);
    this.round6End = this.round5End + duration.days(8);
    this.endTime   = this.round6End + duration.days(9);
    this.afterEndTime = this.endTime + duration.seconds(1);
    this.maxFinalizationTime = this.endTime + duration.weeks(1);
    this.afterMaxFinalizationTime = this.maxFinalizationTime + duration.seconds(1);
    const value = ether(1);
    this.ico = await AthenaLabsICO.new(
        this.startTime
      , [ this.round1End, this.round2End, this.round3End, this.round4End
        , this.round5End, this.round6End, this.endTime]
      , this.maxFinalizationTime
      , wallet
      , [ admin, admin, admin ]
      , {from: owner});

    this.athtoken = AthenaLabsToken.at(await this.ico.token())
  })

  describe('accepting payments', function () {

    it('should be token owner', async function () {
      const owner = await this.athtoken.owner()
      owner.should.equal(this.ico.address)
    })

    it('should be ended only after end', async function () {
      let ended = await this.ico.hasEnded()
      ended.should.equal(false)
      await increaseTimeTo(this.afterEndTime)
      ended = await this.ico.hasEnded()
      ended.should.equal(true)
    })

    it('owner should be token owner after finalization', async function () {
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner})
      await this.ico.destroy({from: owner})
      const final_owner = await this.athtoken.owner()
      final_owner.should.equal(owner)
    })

    it('total supply should be 200M', async function () {
      await increaseTimeTo(this.startTime)
      const totalSupply = await this.athtoken.totalSupply()
      totalSupply.should.be.bignumber.equal(ether(200000000))
    })

    it('total supply should be 8M on no sales', async function () {
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner})
      const totalSupply = await this.athtoken.totalSupply()
      totalSupply.should.be.bignumber.equal(ether(8000000))
    })
  })

  describe('accepting payments', function () {
    const value = ether(1)

    it('should reject payments before start', async function () {
      await this.ico.send(value, {from: investor}).should.be.rejectedWith(EVMThrow)
      await this.ico.buyTokens({from: investor, value: value}).should.be.rejectedWith(EVMThrow)
    })

    it('should accept payments after start', async function () {
      await increaseTimeTo(this.startTime)
      await this.ico.send(value, {from: investor}).should.be.fulfilled
      await this.ico.buyTokens({value: value, from: investor}).should.be.fulfilled
    })

    it('should reject payments after end', async function () {
      await increaseTimeTo(this.afterEndTime)
      await this.ico.send(value, {from: investor}).should.be.rejectedWith(EVMThrow)
      await this.ico.buyTokens({value: value, from: investor}).should.be.rejectedWith(EVMThrow)
    })

  })

  describe('high-level purchase', function () {
    const value = ether(1)
    const expectedTokenAmount = (800 + /*bonus*/320) * value

    beforeEach(async function() {
      await increaseTimeTo(this.startTime)
    })

    it('should log purchase', async function () {
      const {logs} = await this.ico.sendTransaction({value: value, from: investor})

      const event = logs.find(e => e.event === 'TokenPurchase')

      should.exist(event)
      event.args.investor.should.equal(investor)
      event.args.value.should.be.bignumber.equal(value)
      event.args.amount.should.be.bignumber.equal(expectedTokenAmount)
    })

    it('should increase totalSupply', async function () {
      await this.ico.send(value)
      const totalSold = await this.ico.weiTotalAthSold()
      totalSold.should.be.bignumber.equal(expectedTokenAmount)
    })

    it('should assign tokens to sender', async function () {
      await this.ico.sendTransaction({value: value, from: investor})
      let balance = await this.athtoken.balanceOf(investor);
      balance.should.be.bignumber.equal(expectedTokenAmount)
    })

    it('should forward funds to wallet', async function () {
      const pre = web3.eth.getBalance(wallet)
      await this.ico.sendTransaction({value, from: investor})
      const post = web3.eth.getBalance(wallet)
      post.minus(pre).should.be.bignumber.equal(value)
    })

  })

  describe('low-level purchase', function () {
    const value = ether(1)
    const expectedTokenAmount = (800 + /*bonus*/320) * value

    beforeEach(async function() {
      await increaseTimeTo(this.startTime)
    })

    it('should log purchase', async function () {
      const {logs} = await this.ico.buyTokens({value: value, from: investor})

      const event = logs.find(e => e.event === 'TokenPurchase')

      should.exist(event)
      event.args.investor.should.equal(investor)
      event.args.value.should.be.bignumber.equal(value)
      event.args.amount.should.be.bignumber.equal(expectedTokenAmount)
    })

    it('should increase totalSupply', async function () {
      await this.ico.buyTokens({value, from: investor})
      const totalSold = await this.ico.weiTotalAthSold()
      totalSold.should.be.bignumber.equal(expectedTokenAmount)
    })

    it('should assign tokens to investor', async function () {
      await this.ico.buyTokens({value, from: investor})
      const balance = await this.athtoken.balanceOf(investor)
      balance.should.be.bignumber.equal(expectedTokenAmount)
    })

    it('should forward funds to wallet', async function () {
      const pre = web3.eth.getBalance(wallet)
      await this.ico.buyTokens({value, from: investor})
      const post = web3.eth.getBalance(wallet)
      post.minus(pre).should.be.bignumber.equal(value)
    })

  })

  describe('time bonus', function () {
    const value = ether(1)
    it('round 1 bonus 40% is added', async function () {
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + 320))
    })

    it('round 2 bonus 25% is added', async function () {
      await increaseTimeTo(this.round1End)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + 200))
    })

    it('round 3 bonus 15% is added', async function () {
      await increaseTimeTo(this.round2End)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + 120))
    })

    it('round 4 bonus 10% is added', async function () {
      await increaseTimeTo(this.round3End)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + 80))
    })

    it('round 5 bonus 6% is added', async function () {
      await increaseTimeTo(this.round4End)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + 48))
    })

    it('round 6 bonus 3% is added', async function () {
      await increaseTimeTo(this.round5End)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + 24))
    })

    it('round 7 has no bonus', async function () {
      await increaseTimeTo(this.round6End)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * 800)
    })

  })

  describe('quantity bonus', function () {
    it('level 1 bonus 5% is added for 50 ETH', async function () {
      const value = ether(50)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + 40) + /* early bonus */ 7000*10**18)
    })

    it('level 2 bonus 15% is added for 125 ETH', async function () {
      const value = ether(125)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + 120) + /* early bonus */ 18000*10**18)
    })

    it('level 3 bonus 30% is added for 500 ETH', async function () {
      const value = ether(500)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + 240) + /* early bonus */ 110000*10**18)
    })
  })

  describe('early bonus', function () {
    it('bonus 500k for 1000 ETH', async function () {
      const value = ether(1000)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + /* quantity bonus */ 240) + 500000*10**18)
    })

    it('bonus 240k for 750 ETH', async function () {
      const value = ether(750)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + /* quantity bonus */ 240) + 240000*10**18)
    })

    it('bonus 110k for 500 ETH', async function () {
      const value = ether(500)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + /* quantity bonus */ 240) + 110000*10**18)
    })

    it('bonus 50k for 250 ETH', async function () {
      const value = ether(250)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + /* quantity bonus */ 120) + 50000*10**18)
    })

    it('bonus 18k for 100 ETH', async function () {
      const value = ether(100)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + /* quantity bonus */ 40) + 18000*10**18)
    })

    it('bonus 7k for 50 ETH', async function () {
      const value = ether(50)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + /* quantity bonus */ 40) + 7000*10**18)
    })

    it('bonus 2800 for 20 ETH', async function () {
      const value = ether(20)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320) + 2800*10**18)
    })

    it('bonus 1200 for 10 ETH', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320) + 1200*10**18)
    })

    it('lower bonus given when slot is full', async function () {
      const value = ether(1000)
      await increaseTimeTo(this.startTime)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      await this.ico.buyTokens({value, from: investor})
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320 + /* quantity bonus */ 240) + 240000*10**18)
    })
  })

  describe('limits', function () {
    it('cannot buy more than totalSupply', async function () {
      const value = ether(1000000)
      await increaseTimeTo(this.startTime)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor}).should.be.rejectedWith(EVMThrow)
    })

    it('cannot buy for less than 100 finney', async function () {
      const value = finney(99)
      await increaseTimeTo(this.startTime)
      await this.ico.buyTokens({value, from: investor}).should.be.rejectedWith(EVMThrow)
    })
  })

  describe('bounties', function () {
    it('can be awarded', async function () {
      const value = 200 * 10 ** 18;
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.giveTokens([investor], value, {from: owner})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value)
    })

    it('cannot award less than 100 ATH', async function () {
      const value = 99 * 10 ** 18;
      await increaseTimeTo(this.startTime)
      await this.ico.giveTokens([investor], value, {from: owner}).should.be.rejectedWith(EVMThrow)
    })

    it('can be given after finalization', async function () {
      const value = 200 * 10 ** 18;
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner})
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.giveTokens([investor], value, {from: owner})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value)
    })

    it('admins can award', async function () {
      const value = 200 * 10 ** 18;
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.giveTokens([investor], value, {from: admin}).should.be.fulfilled
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value)
    })
  })

  describe('finalization', function () {
    it('cannot be finalized before ending', async function () {
      await this.ico.finalize({from: owner}).should.be.rejectedWith(EVMThrow)
    })

    it('cannot be finalized by third party after ending', async function () {
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: investor}).should.be.rejectedWith(EVMThrow)
    })

    it('can be finalized by owner after ending', async function () {
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner}).should.be.fulfilled
    })
  })

  describe('token control', function () {
    it('cannot transfer tokens before ICO is finalized', async function () {
      const value = 200 * 10 ** 18;
      await increaseTimeTo(this.startTime)
      await this.ico.giveTokens([investor], value, {from: owner})
      await this.athtoken.transfer(investor, value, {from: investor}).should.be.rejectedWith(EVMThrow)
    })

    it('can transfer tokens after ICO is finalized', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner})
      await this.athtoken.transfer(investor, value, {from: investor}).should.be.fulfilled
    })
  })

  describe('ICO pausing', function () {
    it('any admin can pause', async function () {
      await increaseTimeTo(this.startTime)
      await this.ico.pause({from: admin}).should.be.fulfilled
    })

    it('owner can unpause', async function () {
      await increaseTimeTo(this.startTime)
      await this.ico.pause({from: owner})
      await this.ico.unpause({from: owner}).should.be.fulfilled
    })

    it('admin cannot unpause', async function () {
      await increaseTimeTo(this.startTime)
      await this.ico.pause({from: admin})
      await this.ico.unpause({from: admin}).should.be.rejectedWith(EVMThrow)
    })

    it('anyone can unpause after 1 week', async function () {
      await increaseTimeTo(this.startTime)
      await this.ico.pause({from: admin})
      await this.ico.unpause({from: admin}).should.be.rejectedWith(EVMThrow)
      await increaseTimeTo(this.startTime + duration.weeks(1) + duration.seconds(1))
      await this.ico.unpause({from: investor}).should.be.fulfilled
    })

    it('cannot buy tokens when paused', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.pause({from: owner})
      await this.ico.buyTokens({value, from: investor}).should.be.rejectedWith(EVMThrow)
    })

    it('can buy tokens after unpausing', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.pause({from: owner})
      await this.ico.unpause({from: owner})
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor}).should.be.fulfilled
    })
  })

  describe('token burning', function () {
    it('cannot burn tokens before finalized', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      await this.athtoken.burn(12345, {from: investor}).should.be.rejectedWith(EVMThrow)
      await increaseTimeTo(this.afterEndTime)
      await this.athtoken.burn(12345, {from: investor}).should.be.rejectedWith(EVMThrow)
    })

    it('can burn tokens after finalized', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.authorize([investor], {from: admin})
      await this.ico.buyTokens({value, from: investor})
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner})
      const pre = await this.athtoken.balanceOf(investor)
      await this.athtoken.burn(12345, {from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(-12345)
    })
  })

  describe('finalization', function () {
    it('anyone can finalize ICO after maxFinalizationTime', async function () {
      await increaseTimeTo(this.afterMaxFinalizationTime)
      await this.ico.finalize({from: investor}).should.be.fulfilled
    })

    it('anyone can finalize Token after maxFinalizationTime', async function () {
      await increaseTimeTo(this.afterMaxFinalizationTime)
      await this.athtoken.finalize({from: investor}).should.be.fulfilled
    })
  })

  describe('refunding', function () {
    it('admins can refund', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.buyTokens({value, from: investor})
      const preinv = await web3.eth.getBalance(investor)
      const prewal = await web3.eth.getBalance(wallet)
      const preath = await this.ico.weiTotalAthSold()
      await this.ico.refund(investor, {from: admin}).should.be.fulfilled
      const postinv = await web3.eth.getBalance(investor)
      const postwal = await web3.eth.getBalance(wallet)
      const postath = await this.ico.weiTotalAthSold()
      postinv.minus(preinv).should.be.bignumber.equal(finney(9900))
      postwal.minus(prewal).should.be.bignumber.equal(finney(100))
      preath.minus(postath).should.be.bignumber.equal(value * (800 + /* time bonus */ 320) + 1200*10**18)
    })

    it('non admin cannot refund', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.buyTokens({value, from: investor})
      await this.ico.refund(investor, {from: investor}).should.be.rejectedWith(EVMThrow)
    })
  })

  describe('setters', function () {
    it('owner can set admins', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.setAdminAccounts([investor, investor,investor], {from: owner}).should.be.fulfilled
      await this.ico.pause({from: investor}).should.be.fulfilled
      await this.ico.unpause({from:owner})
      await this.ico.pause({from: admin}).should.be.rejectedWith(EVMThrow)
    })

    it('owner can set wallet', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.setMainWallet(admin, {from: owner}).should.be.fulfilled
      await this.ico.authorize([investor], {from: owner})
      const prewal = await web3.eth.getBalance(admin)
      await this.ico.buyTokens({value, from: investor})
      const postwal = await web3.eth.getBalance(admin)
      postwal.minus(prewal).should.be.bignumber.equal(value)
    })
  })

  describe('withdrawal', function () {
    it('noone can withdraw before finalization', async function () {
      await increaseTimeTo(this.startTime)
      await this.ico.withdraw({from: owner}).should.be.rejectedWith(EVMThrow)
    })

    it('owner can withdraw after finalization', async function () {
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner})
      await this.ico.withdraw({from: owner}).should.be.fulfilled
    })

    it('admin can withdraw after maxFinalizationTime', async function () {
      await increaseTimeTo(this.afterMaxFinalizationTime)
      await this.ico.finalize({from: admin})
      await this.ico.withdraw({from: admin}).should.be.fulfilled
    })

    it('nonadmin cannot withdraw even after maxFinalizationTime', async function () {
      await increaseTimeTo(this.afterMaxFinalizationTime)
      await this.ico.finalize({from: investor}).should.be.fulfilled
      await this.ico.withdraw({from: investor}).should.be.rejectedWith(EVMThrow)
    })
  })

  describe('token minting', function () {
    it('only contract can mint tokens', async function () {
      const amount = ether(10)
      await this.athtoken.mint(investor, amount).should.be.rejectedWith(EVMThrow)
    })

    it('cannot mint token after finalization', async function () {
      const amount = ether(10)
      await increaseTimeTo(this.afterEndTime)
      await this.ico.finalize({from: owner})
      await this.athtoken.mint(investor, amount, {from: owner}).should.be.rejectedWith(EVMThrow)
    })
  })

  describe('investment authorization', function () {
    it('does not receive tokens before authorized', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.buyTokens({value, from: investor})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(0)
    })

    it('does receive tokens after authorization', async function () {
      const value = ether(10)
      await increaseTimeTo(this.startTime)
      await this.ico.buyTokens({value, from: investor})
      const pre = await this.athtoken.balanceOf(investor)
      await this.ico.authorize([investor], {from: admin})
      const post = await this.athtoken.balanceOf(investor)
      post.minus(pre).should.be.bignumber.equal(value * (800 + /* time bonus */ 320) + /* early bonus */ 1200*10**18)
    })
  })
})
