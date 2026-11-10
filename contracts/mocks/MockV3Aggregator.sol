// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock fiel al aggregator de Chainlink: devuelve las marcas guardadas, no "ahora".
contract MockV3Aggregator {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
        bool set;
    }

    uint8 public decimals;
    int256 public answer;
    uint80 public roundId = 1;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    mapping(uint80 => Round) private _rounds;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        answer = _initialAnswer;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint80 answered = answeredInRound == 0 ? roundId : answeredInRound;
        return (roundId, answer, startedAt, updatedAt, answered);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round storage r = _rounds[id];
        require(r.set, "no round");
        return (id, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
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
        _rounds[_roundId] = Round({
            answer: _answer,
            startedAt: _startedAt,
            updatedAt: _updatedAt,
            answeredInRound: _answeredInRound,
            set: true
        });
    }
}
