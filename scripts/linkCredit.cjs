/**
 * Enlaza QuatriviumFamaLib para el protocolo soberano en Arbitrum One (chainId: 42161, LUSD).
 * El bytecode de la librería no cuenta para el límite EIP-170 (24,576 bytes).
 *
 * Constantes Arbitrum One (42161):
 * - LUSD: 0x93b346b6BC2548dA6A1E7d98E9a421B42541425b (18 decimales)
 *
 * Referencia Ethereum Mainnet (1):
 * - LUSD: 0x5f98805A4E8be255a32880FDeC7F6728C6568bA0 (18 decimales)
 */
async function getLinkedCreditFactory(ethers, name = 'QuatriviumCredit') {
  const FamaLib = await ethers.getContractFactory('QuatriviumFamaLib');
  const famaLib = await FamaLib.deploy();
  await famaLib.waitForDeployment();
  const famaLibAddress = await famaLib.getAddress();
  const factory = await ethers.getContractFactory(name, {
    libraries: { QuatriviumFamaLib: famaLibAddress },
  });
  factory.famaLibAddress = famaLibAddress;
  return factory;
}

module.exports = { getLinkedCreditFactory };
