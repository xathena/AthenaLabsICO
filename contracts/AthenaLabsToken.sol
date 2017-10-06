pragma solidity ^0.4.4;

import 'zeppelin-solidity/contracts/token/MintableToken.sol';
import 'zeppelin-solidity/contracts/token/BurnableToken.sol';
import 'zeppelin-solidity/contracts/lifecycle/Pausable.sol';

contract AthenaLabsToken is MintableToken, BurnableToken {

  string public name = "ATHENA LABS TOKEN";
  string public symbol = "ATH";
  uint256 public decimals = 18;
  bool public isFinalized = false;

  // only owner (ICO contract) can operate token, when paused
  // token will be unpaused at the end of ICO
  function transfer(address _to, uint256 _value) public whenFinalizedOrOnlyOwner returns (bool) {
    return super.transfer(_to, _value);
  }

  function transferFrom(address _from, address _to, uint256 _value) public whenFinalizedOrOnlyOwner returns (bool) {
    return super.transferFrom(_from, _to, _value);
  }

  function approve(address _spender, uint256 _value) public whenFinalizedOrOnlyOwner returns (bool) {
    return super.approve(_spender, _value);
  }

  function increaseApproval(address _spender, uint _addedValue) public whenFinalizedOrOnlyOwner returns (bool success) {
    return super.increaseApproval(_spender, _addedValue);
  }

  function decreaseApproval(address _spender, uint _subtractedValue) public whenFinalizedOrOnlyOwner returns (bool success) {
    return super.decreaseApproval(_spender, _subtractedValue);
  }

  function burn(uint256 _value) public whenFinalizedOrOnlyOwner {
    return super.burn(_value);
  }

  modifier whenFinalizedOrOnlyOwner() {
    require(isFinalized || (msg.sender == owner));
    _;
  }

  event Finalized();

  /**
   *
   */
  function finalize() onlyOwner public {
    require(!isFinalized);
    finalization();
    Finalized();

    isFinalized = true;
  }

  /**
   * @dev Can be overridden to add finalization logic. The overriding function
   * should call super.finalization() to ensure the chain of finalization is
   * executed entirely.
   */
  function finalization() internal {
    finishMinting();
  }
}
