const chai = require('chai');
const { utils } = require('ethers');
const { ethers } = require('hardhat');
const { solidity } = require('ethereum-waffle');

chai.use(solidity);
const { expect } = chai;

const toWei = (num) => utils.parseEther(num.toString());
const fromWei = (num) => utils.formatEther(num);

let nft;
let marketplace;
let feePercent = 5;
let URI = "sample URI";

beforeEach(async () => {
    [account0, account1, account2, account3] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("NFT");
    nft = await NFT.deploy();
    await nft.deployed();
    console.log("NFT contract deployed to: ", nft.address);
    
    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy(feePercent);
    await marketplace.deployed();
    console.log("\nMarketplace contract deployed to: ", marketplace.address);
});

describe("Deployment of contracts", () => {

    it('NFT should have the correct name and symbol', async () => {
        const nftName = "DApp NFT";
        const nftSymbol = "DAPP";
        expect(await nft.name()).to.eq(nftName);
        expect(await nft.symbol()).to.eq(nftSymbol);
    });

    it('feeAccount and feePercent must be correct in the marketplace contract', async () => {
        expect(await marketplace.feeAccount()).to.eq(account0.address);
        expect(await marketplace.feePercent()).to.eq(5);
    });
});

describe("Minting NFT", () => {

    it("Should be able to track each minted NFT", async () => {
        await nft.connect(account1).mint(URI);
        expect(await nft.tokenCount()).to.eq(1);
        expect(await nft.balanceOf(account1.address)).to.eq(1);
        expect(await nft.tokenURI(1)).to.eq("sample URI");

        await nft.connect(account1).mint(URI);
        expect(await nft.tokenCount()).to.eq(2);
        expect(await nft.balanceOf(account1.address)).to.eq(2);

        await nft.connect(account2).mint(URI);
        expect(await nft.tokenCount()).to.eq(3);
        expect(await nft.balanceOf(account2.address)).to.eq(1);
        expect(await nft.tokenURI(1)).to.eq("sample URI");
    });
});

describe("Making marketplace items", () => {
    let price = '1';

    beforeEach(async () => {
        await nft.connect(account1).mint(URI);
        await nft.connect(account1).setApprovalForAll(marketplace.address, true);
    });

    it("Should track newly created item, transfer NFT from seller to marketplace and emit Offered event", async () => {
        await expect(marketplace.connect(account1).makeItem(nft.address, 1, utils.parseEther(price)))
            .to.emit(marketplace, "Offered")
            .withArgs(
                1,
                nft.address,
                1,
                utils.parseEther(price),
                account1.address
            );
        expect(await nft.ownerOf(1)).to.eq(marketplace.address);
        expect(await marketplace.itemCount()).to.eq(1);

        const item = await marketplace.items(1);
        expect(item.itemId).to.eq(1);
        expect(item.nft).to.eq(nft.address);
        expect(item.tokenId).to.eq(1);
        expect(item.price).to.eq(utils.parseEther('1'));
        expect(item.sold).to.eq(false);
    });

    it("Should fail if price is set to zero", async () => {
        await expect(marketplace.connect(account1).makeItem(nft.address, 1, utils.parseEther('0')))
            .to.be.revertedWith("Price must be greater than zero");
    });
});

describe("Purchasing marketplace items", () => {
    let price = 20;
    let fee = (price * (feePercent/100));
    let totalPriceInWei;

    beforeEach(async () => {
        await nft.connect(account3).mint(URI);
        await nft.connect(account3).setApprovalForAll(marketplace.address, true);
        await marketplace.connect(account3).makeItem(nft.address, 1, toWei(price));
    });

    it("Should update item as sold, pay seller, transfer NFT to buyer, charge fees and emit a Bought event", async () => {
        const sellerInitialEthBal = await account3.getBalance();
        const feeAccountInitialEthBal = await account0.getBalance();
        totalPriceInWei = await marketplace.getTotalPrice(1);
        
        await expect(marketplace.connect(account2).purchaseItem(1, {value: totalPriceInWei}))
            .to.emit(marketplace, "Bought")
            .withArgs(
                1,
                nft.address,
                1,
                toWei(price),
                account3.address,
                account2.address
            );

        const sellerFinalEthBal = await account3.getBalance();
        const feeAccountFinalEthBal = await account0.getBalance();

        expect((await marketplace.items(1)).sold).to.eq(true);
        expect(+fromWei(sellerFinalEthBal)).to.eq(+price + +fromWei(sellerInitialEthBal));
        expect(+fromWei(await feeAccountFinalEthBal)).to.eq(+fee + +fromWei(feeAccountInitialEthBal));
        expect(await nft.ownerOf(1)).to.eq(account2.address);
    });

    it("Should fail for invalid itemId, sold items and when not enough ether is paid", async () => {
        await expect(marketplace.connect(account2).purchaseItem(2, {value: totalPriceInWei}))
            .to.be.revertedWith("the item does not exist");
        await expect(marketplace.connect(account2).purchaseItem(0, {value: totalPriceInWei}))
            .to.be.revertedWith("the item does not exist");
        await expect(marketplace.connect(account2).purchaseItem(1, {value: toWei(price)}))
            .to.be.revertedWith("not enough ether to cover item price and market fee");

        await marketplace.connect(account2).purchaseItem(1, {value: totalPriceInWei});
        await expect(marketplace.connect(account1).purchaseItem(1, {value: totalPriceInWei}))
            .to.be.revertedWith("item already sold");
    });
});