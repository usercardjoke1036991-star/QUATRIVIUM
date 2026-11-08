/** Imprime el calldata para añadir un Safe como admin. No envía la transacción. */
const { Interface } = require('ethers');

function main() {
  const safe = String(process.argv[2] || process.env.SAFE_ADMIN || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(safe)) {
    console.error('Uso: node scripts/setup-safe-admin.cjs 0xSafe');
    process.exit(1);
  }
  const credit = new Interface(['function addAdmin(address newAdmin)']);
  const data = credit.encodeFunctionData('addAdmin', [safe]);
  console.log('Safe', safe);
  console.log('proposeAdminAction data', data);
  console.log('Luego: otra fundadora confirma y, a las 72 h, executeAdminAction.');
  console.log('No se desplegó nada.');
}

main();
