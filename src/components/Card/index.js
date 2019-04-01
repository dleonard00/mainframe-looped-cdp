import React, { Component } from 'react';
import MainframeSDK from '@mainframe/sdk';
import Web3 from 'web3';

import {
  Button,
  Typography,
  Col,
  Tag,
  message,
  Skeleton,
  Alert,
} from 'antd';

import Form from '../Form';
import ListOfValues from '../ListOfValues';

import factoryABI from '../../contracts/Factory.json';
import exchangeABI from '../../contracts/Exchange.json';
import leverageABI from '../../contracts/Leverage.json';
import addresses from '../../addresses.json';

import './index.scss';

const { Text } = Typography;


export default class extends Component {
  state = {
    initialized: false,
    account: '',
    ethBalance: 0,
    ethPrice: 0,
    initialEthValue: 0.1,
    ethValue: 0,
    minEthValue: 0.01,
    maxEthValue: 0,
    initialPercentValue: 50,
    percentValue: 0,
    minPercentValue: 10,
    maxPercentValue: 60,
    collateral: 0,
    debt: 0,
    liquidationPrice: 0,
    leverageContract: null,
    sending: false,
    returnValue: 0,
    collateralizationRatio: 0,
  }

  constructor() {
    super();
    this.sdk = new MainframeSDK();
    this.web3 = new Web3(this.sdk.ethereum.web3Provider);
    this.formRef = React.createRef();
  }

  fromWei(value) {
    return this.web3.utils.fromWei(String(value));
  }

  toWei(value) {
    return this.web3.utils.toWei(String(value));
  }

  async componentDidMount() {
    if (this.sdk.ethereum.web3Provider !== null) {
      this.sdk.ethereum.on('accountsChanged', () => {
        this.fetchState();
      })
      this.sdk.ethereum.on('networkChanged', () => {
        this.fetchState();
      })
      await this.initContracts();
      await this.initValues();
      this.setState({ initialized: true });
    }
    this.fetchState();
  }

  async initContracts() {
    const { factoryAddress, daiAddress, leverageAddress } = addresses;
    const factoryContract = new this.web3.eth.Contract(
      factoryABI,
      factoryAddress,
    );
    const exchangeAddress = await factoryContract.methods
      .getExchange(daiAddress)
      .call();
    const exchangeContract = new this.web3.eth.Contract(
      exchangeABI,
      exchangeAddress,
    );
    const leverageContract = new this.web3.eth.Contract(
      leverageABI,
      leverageAddress,
    );

    const ethPrice = await exchangeContract.methods
      .getTokenToEthOutputPrice(this.toWei(1))
      .call();

    this.setState({
      ethPrice: Number(this.fromWei(ethPrice)),
      leverageContract,
    });
  }

  async fetchState() {
    const accounts = await this.web3.eth.getAccounts();
    if (accounts.length) {
      const account = accounts[0];
      const weiBalance = await this.web3.eth.getBalance(account);
      const ethBalance = this.fromWei(weiBalance);
      this.setState({
        account,
        ethBalance,
      });
    }
  }

  async initValues() {
    const { leverageAddress } = addresses;

    const contractEthBalance =  this.fromWei(await this.web3.eth.getBalance(leverageAddress));
    const ratio = this.state.maxPercentValue / 100;
    const maxEthValue = Number(((contractEthBalance * 0.9) / (ratio + ratio**2 + ratio**3)).toFixed(2));

    let initialEthValue = this.state.initialEthValue;
    if (initialEthValue > maxEthValue) {
      initialEthValue = maxEthValue;
    }
    const ethValue = initialEthValue;
    const percentValue = this.state.initialPercentValue;

    await this.setState({
      initialEthValue,
      ethValue,
      maxEthValue,
      percentValue,
    });

    this.calculateValues();
  }

  calculateValues() {
    const { ethPrice, percentValue, ethValue } = this.state;

    let collateral = 0;
    let debt = 0;
    let liquidationPrice = 0;
    let returnValue = 0;
    let collateralizationRatio = Infinity;

    if (percentValue > 0 && ethValue > 0) {
      const ratio = percentValue / 100;
      let currentValue = ethValue;
      collateral = currentValue;
      for (let i = 0; i < 3; i++) {
        currentValue *= ratio;
        collateral += currentValue;
      }
      
      currentValue = ethPrice;
      for (let i = 0; i < 4; i++) {
        currentValue *= ratio;
        debt += currentValue;
      }
      debt *= ethValue;

      returnValue = debt - ((collateral - ethValue) * ethPrice);
      collateralizationRatio = Math.round(100 / (percentValue / 100));
      liquidationPrice = ((debt / collateral / 2) * 3) || 0;
    }
    
    this.setState({
      collateral,
      debt,
      liquidationPrice,
      returnValue,
      collateralizationRatio,
    });
  }

  changeValue = name => async value => {
    if (typeof value !== 'number') return;
    await this.setState({ [name]: Number(value) });
    this.calculateValues();
  }

  sendingStart() {
    this.setState({ sending: true });
  }

  sendingEnd() {
    this.setState({ sending: false });
  }

  leverage = async () => {
    const {
      collateral,
      debt,
      leverageContract,
      account,
      ethValue,
    } = this.state;
    try {
      this.sendingStart();
      await leverageContract.methods.riskNewCDP(
        this.toWei(collateral),
        this.toWei(debt),
        true,
      ).send({ value: this.toWei(ethValue), from: account });
      this.sendingEnd();
      message.success('Transaction sent');
    } catch (error) {
      this.sendingEnd();
      message.error(error.message);
    }
  }

  render() {
    const {
      ethPrice,
      collateral,
      debt,
      liquidationPrice,
      returnValue,
      collateralizationRatio,
      initialEthValue,
      minEthValue,
      maxEthValue,
      initialPercentValue,
      minPercentValue,
      maxPercentValue,
    } = this.state;
    const percentValue = this.state.percentValue;

    const isDanger = percentValue > 50;
    const labelColor = isDanger ? 'red' : 'green';
    const labelText = isDanger ? 'danger' : 'safe';

    let disabled = false;
    if (this.formRef.current) {
      const errors = this.formRef.current.props.form.getFieldsError(['ethValue', 'percentValue']);
      disabled = errors.ethValue || errors.percentValue;
    }

    return (
      <div className="card-container">
        {!this.state.initialized ? (
          <div>
            <Skeleton active />
            <Skeleton active />
            <Skeleton active />
          </div>
        ) : (
          <div>
            <Col align="center">
              <Text className="title">
                Leveraged Collateralized
              </Text>
              <br />
              <Text className="title">
                Debt Position
              </Text>
            </Col>
            <Form
              wrappedComponentRef={this.formRef}
              changeEthValue={this.changeValue('ethValue')}
              changePercentValue={this.changeValue('percentValue')}
              ethValue={{
                initial: initialEthValue,
                min: minEthValue,
                max: maxEthValue,
              }}
              percentValue={{
                initial: initialPercentValue,
                min: minPercentValue,
                max: maxPercentValue,
              }}
            />
            <ListOfValues
              data={[
                {
                  text: 'Current ETH price',
                  value: `$${ethPrice.toFixed(2)}`,
                },
                {
                  text: 'Expected Collateral (ETH)',
                  value: collateral.toFixed(3),
                },
                {
                  text: 'Expected Debt (DAI)',
                  value: debt.toFixed(2),
                },
                {
                  text: 'Expected Change (DAI)',
                  value: returnValue.toFixed(2),
                },
                {
                  text: 'Expected Liquidation Price',
                  value: `$${liquidationPrice.toFixed(2)}`,
                },
                {
                  text: 'Expected Collateralization Ratio',
                  value: collateralizationRatio + (collateralizationRatio !== Infinity && '%'),
                },
                {
                  text: 'Expected Status',
                  value: <Tag color={labelColor} className="tag">{labelText}</Tag>,
                },
              ]}
            />
            <Alert
              message="The final values may slightly differ from this calculator due to exchange rate volatility and slippage."
              type="info"
              showIcon
              className="alert"
            />
            <Button
              className="button"
              type="primary"
              disabled={disabled}
              onClick={this.leverage}
              block
              loading={this.state.sending}
            >Loop it!</Button>
          </div>
        )}
      </div>
    );
  }
}
