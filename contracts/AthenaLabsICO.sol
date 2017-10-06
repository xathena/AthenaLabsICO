pragma solidity ^0.4.4;

import 'zeppelin-solidity/contracts/token/MintableToken.sol';
import 'zeppelin-solidity/contracts/math/SafeMath.sol';
import 'zeppelin-solidity/contracts/ownership/Ownable.sol';

import './AthenaLabsToken.sol';

contract AthenaLabsICO is Ownable, Pausable {
  using SafeMath for uint256;

  uint256 public startTime;
  uint256[7] public endOfRounds;
  uint256 public endTime;

  // multisig addr for transfers
  address public mainWallet;

  // addrs for whitelist, remove from whitelist
  address[3] public adminAccounts;

  // addrs for view internal state
  address[3] public readAccounts;

  // rate ATH : ETH
  uint256 public rate;

  // limited slots for Early bonuses
  uint256[8] public earlySlots = [10, 5, 5, 5, 3, 3, 2, 2];

  AthenaLabsToken public token;

  uint256 public weiTotalAthCap;
  uint256 public weiTotalBountiesGiven;

  bool public isFinalized = false;

  // ID authorization of Investors

  struct Investor {
    uint256 etherInvested;
    uint256 athReceived;
    uint256 etherInvestedPending;
    uint256 athReceivedPending;
    bool authorized;
    bool exists; // this is to indicate, whether this investor is new
  }

  mapping (address => Investor) public investors;
  address[] investor_list;

  event Finalized();
    /**
   * event for token purchase logging
   * @param investor who paid for the tokens
   * @param value weis paid for purchase
   * @param amount amount of tokens purchased
   */
  event TokenPurchase(address indexed investor, uint256 value, uint256 amount);

  /* Same as TokenPurchase, but not sent. Only reserved and waiting for approval. */
  event TokenPurchasePending(address indexed investor, uint256 value, uint256 amount);

  // When an investor is approved to invest more than 2.1ETH
  event Authorized(address indexed investor);
    /**
   * event for giving away tokens as bounty
   * @param beneficiary who got the tokens
   * @param amount amount of tokens given
   */
  event TokenBounty(address indexed beneficiary, uint256 amount);
  /**
  * event for refunding ETH, when the investor is not approved
  */
  event Refunded(address indexed investor, uint256 weiEthReturned, uint256 weiAthBurned);

  function AthenaLabsICO( uint256 _startTime
                        , uint256[7] _endOfRounds
                        , address _mainWallet
                        , address[3] _adminAccounts
                        , address[3] _readAccounts) {
    require(_startTime   >= now);
    require(_endOfRounds.length == 7);
    require(_endOfRounds[0] >= _startTime);
    require(_endOfRounds[1] >= _endOfRounds[0]);
    require(_endOfRounds[2] >= _endOfRounds[1]);
    require(_endOfRounds[3] >= _endOfRounds[2]);
    require(_endOfRounds[4] >= _endOfRounds[3]);
    require(_endOfRounds[5] >= _endOfRounds[4]);
    require(_endOfRounds[6] >= _endOfRounds[5]);
    require(_mainWallet != 0x0);
    require(_adminAccounts[0] != 0x0);
    require(_adminAccounts[1] != 0x0);
    require(_adminAccounts[2] != 0x0);
    require(_readAccounts[0] != 0x0);
    require(_readAccounts[1] != 0x0);
    require(_readAccounts[2] != 0x0);

    startTime   = _startTime;
    endOfRounds = _endOfRounds;
    endTime     = _endOfRounds[6];

    mainWallet  = _mainWallet;

    adminAccounts      = _adminAccounts;
    readAccounts       = _readAccounts;

    rate               = 800;
    token = new AthenaLabsToken();

    weiTotalAthCap = 200000000 * 10 ** token.decimals();

    // mint tokens for bounties and keep it on this contract
    token.mint(this, 8000000 * 10 ** token.decimals());
  }

  modifier canAdmin() {
    require(  (msg.sender == adminAccounts[0])
            ||(msg.sender == adminAccounts[1])
            ||(msg.sender == adminAccounts[2])
            ||(msg.sender == owner));
    _;
  }

  // admins can pause (but not unpause!)
  function pause() canAdmin whenNotPaused public {
    paused = true;
    Pause();
  }

  // fallback function can be used to buy tokens
  function () whenNotPaused payable {
    buyTokens();
  }

  // low level token purchase function
  function buyTokens() public whenNotPaused payable {
    require(msg.sender != 0x0);
    require(validPurchase());

    uint256 weiEther = msg.value;

    // calculate token amount to be created and reduce slots for limited bonuses
    uint256 weiTokens = weiEther.mul(rate).add(calculateAndRegisterBonuses(weiEther));

    require(token.totalSupply().add(weiTokens) <= weiTotalAthCap);

    // decide what to do depending on whether this investor is already authorized
    Investor storage investor = investors[msg.sender];
    if (!investor.exists) {
      investor_list.push(msg.sender);
      investor.exists = true;
    }
    if (   investor.authorized
        || investor.etherInvested.add(weiEther) <= 2100 finney) {
      investor.etherInvested = investor.etherInvested.add(weiEther);
      investor.athReceived = investor.athReceived.add(weiTokens);
      TokenPurchase(msg.sender, weiEther, weiTokens);
      token.mint(msg.sender, weiTokens);
      mainWallet.transfer(weiEther);
    } else {
      /* if not authorized yet and over authorization limit, received ETH is
      saved on this contract instead and ATH is minted to this contract */
      investor.etherInvestedPending = investor.etherInvestedPending.add(weiEther);
      investor.athReceivedPending = investor.athReceivedPending.add(weiTokens);
      TokenPurchasePending(msg.sender, weiEther, weiTokens);
      // pending ATH is minted to this contract
      token.mint(this, weiTokens);
      // pending ETH stays on this contract
    }
  }

  // @return true if the transaction can buy tokens
  function validPurchase() internal constant returns (bool) {
    bool withinPeriod = now >= startTime && now <= endTime;
    bool nonTrivialPurchase = msg.value > 100 finney;
    return withinPeriod && nonTrivialPurchase;
  }

  function authorize(address investor_addr) canAdmin whenNotPaused public {
    Investor storage investor = investors[investor_addr];
    require(!investor.authorized);
    uint256 athToSend = investor.athReceivedPending;
    uint256 ethToForward = investor.etherInvestedPending;
    investor.etherInvested = investor.etherInvested.add(ethToForward);
    investor.athReceived = investor.athReceived.add(athToSend);
    investor.authorized = true;
    if (!investor.exists) {
      investor_list.push(msg.sender);
      investor.exists = true;
    }
    Authorized(investor_addr);
    if (ethToForward > 0) {
      TokenPurchase(investor_addr, ethToForward, athToSend);
      mainWallet.transfer(ethToForward);
      token.transfer(investor_addr, athToSend);
    }
  }

  function refund(address investor_addr) onlyOwner public {
    Investor storage investor = investors[investor_addr];
    require(!investor.authorized);
    // when returning, fee is taken for the additional effort/trouble
    uint256 ethToForward = 100 finney;
    uint256 ethToReturn = investor.etherInvestedPending.sub(ethToForward);
    require(ethToReturn > 0);
    uint256 athToBurn = investor.athReceivedPending;
    investor.etherInvestedPending = 0;
    investor.athReceivedPending = 0;
    Refunded(investor_addr, ethToReturn, athToBurn);
    // burn tokens reserved for this investment
    token.burn(athToBurn);
    // forward fee
    mainWallet.transfer(ethToForward);
    // return investment
    investor_addr.transfer(ethToReturn);
  }

  // @return true if crowdsale event has ended
  function hasEnded() public constant returns (bool) {
    return now > endTime;
  }

  function giveTokens(address beneficiary, uint256 weiTokens) onlyOwner public payable {
    require(beneficiary != 0x0);
    require(weiTokens >= 100 * 10 ** token.decimals());
    require(weiTotalBountiesGiven.add(weiTokens) <= 8000000*10**token.decimals());
    weiTotalBountiesGiven = weiTotalBountiesGiven.add(weiTokens);
    TokenBounty(beneficiary, weiTokens);
    token.transfer(beneficiary, weiTokens);
  }

  function calculateAndRegisterBonuses(uint256 weiEther) internal returns (uint256) {
    uint256 time     = calculateTimeBonuses(weiEther);
    uint256 quantity = calculateQuantityBonuses(weiEther);
    uint256 early    = calculateAndRegisterEarlyBonuses(weiEther);
    return time.add(quantity).add(early);
  }

  function calculateTimeBonuses(uint256 weiEther) internal returns (uint256) {
    if (startTime <= now && now < endOfRounds[0]) {
      return weiEther.mul(320); // 40% of rate
    }
    if (endOfRounds[0] <= now && now < endOfRounds[1]) {
      return weiEther.mul(200); // 25% of rate
    }
    if (endOfRounds[1] <= now && now < endOfRounds[2]) {
      return weiEther.mul(120); // 415 of rate
    }
    if (endOfRounds[2] <= now && now < endOfRounds[3]) {
      return weiEther.mul(80); // 10% of rate
    }
    if (endOfRounds[3] <= now && now < endOfRounds[4]) {
      return weiEther.mul(48); // 6% of rate
    }
    if (endOfRounds[4] <= now && now < endOfRounds[5]) {
      return weiEther.mul(24); // 3% of rate
    }
    return 0;
  }

  function calculateQuantityBonuses(uint256 weiEther) internal returns (uint256) {
    if (weiEther >= 500 ether) {
      return weiEther.mul(240); // 30% of rate
    }
    if (weiEther >= 125 ether) {
      return weiEther.mul(120); // 15% of rate
    }
    if (weiEther >= 50 ether) {
      return weiEther.mul(40); // 5% of rate
    }
    return 0;
  }

  function calculateAndRegisterEarlyBonuses(uint256 weiEther) internal returns (uint256) {
    if (weiEther >= 1000 ether && earlySlots[7] > 0) {
      earlySlots[7] = earlySlots[7].sub(1);
      return 500000 * 10 ** token.decimals();
    }
    if (weiEther >= 750 ether && earlySlots[6] > 0) {
      earlySlots[6] = earlySlots[6].sub(1);
      return 240000 * 10 ** token.decimals();
    }
    if (weiEther >= 500 ether && earlySlots[5] > 0) {
      earlySlots[5] = earlySlots[5].sub(1);
      return 110000 * 10 ** token.decimals();
    }
    if (weiEther >= 250 ether && earlySlots[4] > 0) {
      earlySlots[4] = earlySlots[4].sub(1);
      return 50000 * 10 ** token.decimals();
    }
    if (weiEther >= 100 ether && earlySlots[3] > 0) {
      earlySlots[3] = earlySlots[3].sub(1);
      return 18000 * 10 ** token.decimals();
    }
    if (weiEther >= 50 ether && earlySlots[2] > 0) {
      earlySlots[2] = earlySlots[2].sub(1);
      return 7000 * 10 ** token.decimals();
    }
    if (weiEther >= 20 ether && earlySlots[1] > 0) {
      earlySlots[1] = earlySlots[1].sub(1);
      return 2800 * 10 ** token.decimals();
    }
    if (weiEther >= 10 ether && earlySlots[0] > 0) {
      earlySlots[0] = earlySlots[0].sub(1);
      return 1200 * 10 ** token.decimals();
    }
    return 0;
  }

  /**
   * @dev Must be called after crowdsale ends, to do some extra finalization
   * work. Calls the contract's finalization function.
   */
  function finalize() onlyOwner public {
    require(!isFinalized);
    require(hasEnded());

    finalization();
    Finalized();

    isFinalized = true;
  }

  function finalization() internal {
    token.finalize();
  }

  function destroy() onlyOwner public {
    require(isFinalized);
    uint256 bountiesLeft = (8000000*10**token.decimals()).sub(weiTotalBountiesGiven);
    token.transfer(owner, bountiesLeft);
    token.transferOwnership(owner);
    // tokens left on this contract (from unauthorized and not refunded investments) are lost
    selfdestruct(owner);
  }
}