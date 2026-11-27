/**
 * Imprime el calldata para reemplazar un admin por un Safe en Credit y en Reserva.
 * No envía ninguna transacción. Las dos partes ya tienen 3 admins (el máximo):
 * primero se quita al admin saliente (paso 1) y, solo cuando ese paso se ejecutó, se añade el Safe (paso 2).
 */
const { Interface, getAddress, ZeroAddress } = require('ethers');

const ADDR = /^0x[0-9a-fA-F]{40}$/;

function main() {
  const safeIn = String(process.argv[2] || process.env.SAFE_ADMIN || '').trim();
  const saleIn = String(process.argv[3] || process.env.ADMIN_SALIENTE || '').trim();
  if (!ADDR.test(safeIn) || !ADDR.test(saleIn)) {
    console.error('Uso: node scripts/setup-safe-admin.cjs 0xSafe 0xAdminSaliente');
    process.exit(1);
  }
  const safe = getAddress(safeIn.toLowerCase());
  const saliente = getAddress(saleIn.toLowerCase());
  if (safe === ZeroAddress || saliente === ZeroAddress || safe === saliente) {
    console.error(
      'El Safe y el admin saliente tienen que ser dos direcciones distintas y no cero.'
    );
    process.exit(1);
  }
  const iface = new Interface([
    'function removeAdmin(address admin)',
    'function addAdmin(address newAdmin)',
  ]);
  const quitar = iface.encodeFunctionData('removeAdmin', [saliente]);
  const poner = iface.encodeFunctionData('addAdmin', [safe]);
  console.log('Safe', safe);
  console.log('Admin saliente', saliente);
  console.log(`Credit paso 1 proposeAdminAction removeAdmin ${quitar}`);
  console.log(`Credit paso 2 proposeAdminAction addAdmin ${poner}`);
  console.log(`Reserva paso 1 proponerAdmin removeAdmin ${quitar}`);
  console.log(`Reserva paso 2 proponerAdmin addAdmin ${poner}`);
  console.log('Cada paso: un admin propone, otro confirma y, a las 72 h, se ejecuta.');
  console.log(
    'Propón el paso 2 solo después de ejecutar el paso 1; con 3 admins, addAdmin revierte.'
  );
  console.log('No se desplegó nada.');
}

main();
