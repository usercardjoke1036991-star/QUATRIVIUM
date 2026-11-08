// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockV3Aggregator {
    uint8 public decimals;
    int256 public answer;
    uint80 public roundId = 1;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        answer = _initialAnswer;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 t = updatedAt == 0 ? block.timestamp : updatedAt;
        uint256 s = startedAt == 0 ? t : startedAt;
        uint80 answered = answeredInRound == 0 ? roundId : answeredInRound;
        return (roundId, answer, s, t, answered);
    }

    function updateAnswer(int256 _answer) external {
        answer = _answer;
        roundId += 1;
        startedAt = 0;
        updatedAt = 0;
        answeredInRound = 0;
    }

    function setRound(
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }
}
