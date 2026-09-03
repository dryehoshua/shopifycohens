# Estrategia Nekudot para la tienda online

## Decisión ejecutiva

Nekudot debe operar como un solo programa omnicanal: la misma persona, wallet,
nivel y saldo sirven en tienda física y online. Shopify conserva la identidad de
compra y los pedidos; la base Nekudot conserva la wallet y el libro mayor.

El orden correcto es:

1. identificar al comprador;
2. asociar el pedido a su cliente Shopify y miembro Nekudot;
3. acreditar cashback cuando el pedido esté pagado;
4. ajustar o revertir el cashback cuando exista devolución o cancelación;
5. mostrar saldo, movimientos y pedidos desde la cuenta del cliente.

El IB es una atribución comercial para miembros Blue. No es un requisito para
que una persona vea su saldo. Silver, Blue y Golden deben poder consultar sus
propios Nekudot después de iniciar sesión. En Blue, el IB queda fijado al
registrarse con un código o enlace verificado y no debe poder cambiarse desde el
carrito.

Un IB también puede tener su propia tarjeta Blue vinculada a su perfil IB. En una
compra propia recibe dos beneficios separados:

- **5% de cashback Blue** en su wallet personal Nekudot;
- **5% de comisión IB** en su wallet comercial.

El beneficio económico combinado es 10%, pero no debe mostrarse como “10% de
Nekudot” ni mezclarse como un solo saldo. Tampoco es un descuento inmediato de
checkout salvo que posteriormente se construya un mecanismo de canje. Cada bolsa
tiene movimientos, reglas de retiro/canje y reversas independientes.

## Lo que ya existe

El proyecto ya tiene la mayor parte del motor necesario:

- `NekudotMember`: wallet única y nivel Silver, Blue o Golden;
- `NekudotCustomerIdentity`: relación entre miembro y cliente Shopify por tienda;
- `NekudotOrderAccrual`: acumulación idempotente por pedido;
- `NekudotLedgerEntry`: libro mayor de acumulaciones, canjes, comisiones y reversas;
- portal `/mi-nekudot` con acceso por OTP SMS;
- registro que crea o encuentra al cliente Shopify y genera su identidad Nekudot;
- asociación permanente entre miembros Blue e IB;
- capacidad conceptual de que un IB tenga además su propio miembro Blue;
- sincronización de `orders/create`, `orders/updated` y `refunds/create`;
- cálculo proporcional después de reembolsos y reversión por cancelación.

El hueco actual está en la experiencia online: el reconciliador sólo acredita
cuando el pedido contiene un `customerId` ya vinculado, una reserva o un
`nekudot_member_id`. Si un invitado compra sin esa identidad, el pedido se guarda,
pero no queda una reclamación Nekudot pendiente para enlazarla después.

## Experiencia propuesta

### 1. Entrada a la tienda

En el encabezado debe existir una entrada visible: **Mi cuenta / Mis Nekudot**.
La portada, fichas de producto y carrito deben explicar el beneficio con una sola
promesa: **“Inicia sesión y recibe 2%, 5% u 8% de regreso en tus compras.”**

No se debe obligar a iniciar sesión para navegar ni bloquear el checkout como
invitado. Antes de pagar, el carrito muestra:

- con sesión: “Esta compra generará aproximadamente $X en Nekudot”;
- sin sesión: “Inicia sesión para recibir $X en Nekudot”;
- con enlace IB: “Estás comprando con la invitación de [nombre/comunidad]”; esto
  sólo propone el registro Blue, no acredita ni cambia de IB por sí solo.

### 2. Registro e inicio de sesión

La cuenta Shopify debe ser la puerta principal de la tienda online. Al iniciar
sesión, el backend recibe la identidad autenticada de Shopify y busca
`NekudotCustomerIdentity` por `shop + shopifyCustomerId`.

- Si existe, se muestra la wallet actual.
- Si el cliente Shopify existe pero todavía no tiene Nekudot, se crea Silver al
  aceptar los términos del programa.
- Si llega por un enlace IB, se ofrece registro Blue con el código ya cargado.
- Golden mantiene su activación sólo después de la confirmación de pago de la
  membresía.
- Si correo y teléfono parecen pertenecer a miembros distintos, no se fusiona de
  forma automática; se manda a revisión para evitar robo de saldo.

Si el sistema detecta que la persona probablemente ya estaba registrada, no debe
rechazarla con un error genérico. Debe abrir un flujo de **Encontramos una cuenta
que podría ser tuya**:

1. mostrar una lista corta de coincidencias con datos enmascarados, por ejemplo
   “David C. · teléfono terminado en 4821”;
2. permitir que la persona seleccione su cuenta;
3. enviar un OTP al teléfono o correo que ya está guardado en esa cuenta;
4. vincular la nueva tarjeta o credencial sólo después de validar el OTP;
5. ofrecer “Ninguna soy yo” y revisión asistida cuando no pueda acceder al medio
   registrado.

La selección visual por sí sola nunca autoriza la vinculación. No se deben mostrar
nombres completos, teléfonos completos, correos ni saldos de otras personas. Una
coincidencia sólo por nombre requiere siempre verificación adicional; teléfono o
correo normalizados pueden usarse para localizar candidatos, pero también exigen
OTP antes de mover o unir identidades.

El portal `/mi-nekudot` puede continuar como respaldo y para la tarjeta digital,
pero el cliente online no debería tener que entender dos inicios de sesión.

### 3. Asociación de pedidos

Se usará esta jerarquía de identidad, de mayor a menor confianza:

1. `shop + Shopify Customer ID` autenticado;
2. `nekudot_member_id` firmado por el backend y trasladado del carrito al pedido;
3. reserva Nekudot creada antes del checkout;
4. reclamación posterior del pedido mediante OTP al teléfono o correo del pedido.

Nunca se debe acreditar únicamente porque alguien escribió un correo, un teléfono
o un código IB. Esos datos sirven para iniciar la verificación, no para mover saldo.

Para una compra con sesión, el carrito puede llevar una referencia interna firmada
o un metafield reservado de la aplicación. El backend vuelve a validar que el
miembro corresponde al cliente autenticado. No se debe confiar directamente en un
atributo editable desde el navegador.

### 3.1 Una tarjeta, tres formas de identificarla

Cada persona tiene un solo miembro, un solo nivel vigente —Plata, Blue o Golden— y
una wallet personal, pero puede tener varias credenciales activas asociadas a esa
misma tarjeta:

- QR digital;
- UID de la tarjeta NFC física;
- código de barras impreso o digital.

Las tres deben resolver al mismo `NekudotMember`; no crean tres cuentas ni tres
saldos. Conviene guardar cada medio como una `NekudotCredential` independiente con
tipo `QR`, `NFC` o `BARCODE`, hash, últimos cuatro caracteres, estado y fecha de
revocación. Así se puede reemplazar una tarjeta NFC perdida sin invalidar
necesariamente el QR o el código de barras.

El código actual genera QR y código de barras a partir del mismo token y sólo
registra la credencial como `QR`; además, el servidor sólo acepta `RFID`, `QR` o
`RFID_OR_QR`. Para cumplir completamente este diseño se debe añadir `BARCODE` y
registrar explícitamente cada medio, o documentar que QR y barras son dos
representaciones del mismo identificador digital. Se recomienda la primera opción
por auditoría y revocación selectiva.

Cuando se entrega una tarjeta física, el flujo de activación es:

1. escanear el código de barras o NFC de la tarjeta;
2. buscar o registrar a la persona;
3. si hay coincidencias, seleccionar y validar OTP;
4. asociar NFC, QR y código de barras al miembro confirmado;
5. mostrar nombre, nivel y últimos cuatro de cada credencial antes de guardar.

### 3.2 IB con tarjeta Blue propia

El perfil IB y el miembro cliente son dos roles de la misma persona, no la misma
wallet. Debe existir una relación explícita `IB propietario -> miembro Blue propio`
para distinguir la cuenta propia de los referidos normales.

En cada compra elegible del IB:

1. el pedido se asocia a su miembro Blue;
2. se acredita 5% a su wallet personal;
3. se acredita otro 5% a su wallet IB;
4. el ledger genera dos asientos con el mismo pedido como fuente;
5. una devolución revierte proporcionalmente ambos asientos.

En el portal se muestran dos tarjetas de saldo: **Mis Nekudot** y **Mis comisiones
IB**. El IB puede aparecer en su red con la etiqueta “Cuenta propia”, pero debe
separarse de las métricas de “personas referidas” para no inflar su red.

### 4. Compra como invitado

El checkout invitado sigue disponible para no perder conversión. Al crear un
pedido sin miembro identificado se crea `NekudotPendingClaim` con:

- tienda y pedido Shopify únicos;
- importe elegible y moneda;
- hash del correo/teléfono normalizado, sin usar el dato como prueba de identidad;
- fecha límite de reclamación;
- estado `PENDING`, `CLAIMED`, `EXPIRED` o `REVERSED`.

En la página de confirmación y en el mensaje transaccional se muestra:
**“Tienes $X en Nekudot pendientes. Verifica tu cuenta para reclamarlos.”**

Al completar OTP:

1. se encuentra o crea el cliente Shopify correcto;
2. se vincula la identidad Nekudot;
3. se asocia el pedido al miembro;
4. se ejecuta nuevamente la conciliación del pedido;
5. se marca la reclamación como `CLAIMED`.

Ventana recomendada: 30 días. El importe nunca se vuelve disponible antes de
verificar la identidad y el pedido sólo se puede reclamar una vez.

### 5. Momento de acreditación y devoluciones

Para la primera versión, el cashback se vuelve disponible cuando Shopify confirma
que el pedido está pagado. Esto es coherente con la lógica presencial actual y es
fácil de explicar al cliente.

- pedido creado, pero no pagado: no acredita;
- pedido pagado: acredita sobre venta elegible neta;
- devolución parcial: resta la proporción correspondiente;
- cancelación o devolución total: revierte todo;
- reintento de webhook: no duplica movimientos;
- cambio posterior de nivel o IB: no reescribe la tasa ni el IB que ya quedaron
  fijados para el pedido original.

En una segunda etapa se puede separar saldo `pendiente` y `disponible` hasta el
envío o hasta cumplir una ventana antifraude. No es necesario para lanzar si las
reversas están probadas y auditadas.

## Portal de cliente

Dentro de las nuevas cuentas de cliente Shopify se debe añadir una página
**Mis Nekudot** con:

- saldo disponible;
- nivel y porcentaje vigente;
- estimado de cashback del pedido actual cuando aplique;
- últimos movimientos y motivo de cada ajuste;
- pedidos que generaron cashback;
- reclamaciones pendientes;
- tarjeta digital QR/código de barras;
- nombre del IB sólo para miembros Blue;
- para un IB, dos saldos separados: cashback personal y comisión IB;
- credenciales activas QR, NFC y código de barras, con opción de bloquear una
  credencial perdida;
- botón para volver a comprar.

También se debe mostrar un bloque en la página de estado de cada pedido:
“Este pedido generó $X”, “pendiente de pago”, “reclámalo” o “ajustado por
devolución”. Shopify admite extensiones específicas para cuentas de cliente y
estado de pedido, incluida una página completa para programas de lealtad.

## Estrategia de adquisición y conversión

### Mensaje principal

**Compra lo que necesitas y recibe dinero para tu siguiente compra.**

La comunicación debe usar pesos, no puntos abstractos: “$48 disponibles” es más
claro que “4,800 puntos”. Nekudot puede mantenerse como nombre del programa.

### Embudo

1. **Descubrimiento:** banner, redes, WhatsApp autorizado y enlaces de IB.
2. **Consideración:** porcentaje y cashback estimado en producto y carrito.
3. **Identificación:** inicio de sesión simple antes del checkout.
4. **Conversión:** checkout invitado permitido, con oportunidad de reclamar.
5. **Activación:** confirmación con cashback obtenido y botón “Ver mis Nekudot”.
6. **Recompra:** recordatorio cuando el saldo sea suficiente para una compra útil,
   no mensajes masivos sin consentimiento.

### Enlaces IB

Cada IB comparte una URL del tipo `/registro/blue?ib=CODIGO` y, después del
registro, el cliente es enviado a una colección o landing preparada para comprar.
La atribución debe persistir sólo hasta completar el registro verificado. El IB
queda ligado al miembro Blue, no al navegador ni a cada pedido individual.

## Trabajo técnico por fases

### Fase 0 — Validación de producción

- confirmar que la tienda usa las nuevas cuentas de cliente Shopify;
- confirmar permisos de datos protegidos de clientes;
- verificar que los webhooks reales apuntan al alojamiento de producción;
- ejecutar una compra pagada de prueba con cliente ya vinculado y comprobar
  pedido, acumulación y asiento en ledger;
- revisar que `orders/updated` y `refunds/create` efectivamente llegan y se
  procesan una sola vez.

### Fase 1 — Cashback online para clientes identificados

- añadir acceso **Mi cuenta / Mis Nekudot** al storefront;
- alinear la sesión Shopify con `NekudotCustomerIdentity`;
- propagar una atribución firmada del miembro al pedido;
- mostrar saldo y movimientos dentro de la cuenta Shopify;
- mostrar cashback estimado en carrito y cashback real en estado de pedido;
- agregar trazabilidad de `orders/paid` además de la conciliación por actualización;
- ejecutar una conciliación nocturna de seguridad para pedidos modificados.
- mostrar por separado cashback y comisión cuando el comprador también sea IB.

Resultado: todo cliente registrado que inicia sesión acumula online y ve el mismo
saldo que en tienda física.

### Fase 2 — Recuperación de compras invitadas

- crear `NekudotPendingClaim`;
- generar la reclamación desde pedidos sin miembro;
- añadir CTA de reclamación en confirmación y comunicaciones transaccionales;
- verificar por OTP y reejecutar la conciliación;
- añadir panel administrativo para reclamaciones pendientes, vencidas y en
  conflicto.

Resultado: comprar sin sesión ya no significa perder para siempre el cashback.

### Fase 2.1 — Recuperación de cuenta y tarjeta multicanal

- cambiar el rechazo de duplicados por una búsqueda de candidatos enmascarados;
- añadir desafío OTP sobre el contacto ya registrado;
- implementar revisión asistida cuando el contacto anterior ya no esté disponible;
- extender credenciales con tipo `BARCODE`;
- registrar y administrar QR, NFC y código de barras por separado;
- permitir revocación individual y reemplazo seguro sin crear otra wallet.

### Fase 3 — Canje online

- reservar saldo antes de redirigir al checkout;
- aplicar el beneficio mediante el mecanismo de descuento compatible con el plan
  de Shopify;
- llevar `nekudot_redemption_id` al pedido;
- confirmar el débito sólo cuando el pedido quede pagado;
- cancelar la reserva al abandonar o cancelar y restituir proporcionalmente en
  devoluciones.

El canje online debe lanzarse después de estabilizar acumulación, identidad y
reversas. Primero se gana y se consulta online; después se permite gastar.

## Controles indispensables

- una wallet por persona y una identidad Shopify por tienda;
- una acumulación por `shop + shopifyOrderId`;
- tasas guardadas como enteros en puntos base;
- dinero guardado en centavos y moneda validada;
- firma y caducidad en referencias enviadas al navegador;
- OTP y rate limiting para reclamar o fusionar cuentas;
- resultados de coincidencia siempre enmascarados y limitados;
- ningún enlace de cuenta basado únicamente en nombre o selección visual;
- relación explícita y única entre un IB y su miembro Blue propio;
- no exponer IDs internos, UID RFID ni saldos mediante atributos públicos;
- registro de cada cambio en el ledger, sin editar movimientos históricos;
- cola de reintentos y alarma para webhooks fallidos;
- consentimiento de privacidad separado del consentimiento de marketing.

## Métricas del lanzamiento

Durante las primeras cuatro semanas medir:

- porcentaje de pedidos online con cliente identificado;
- porcentaje de pedidos elegibles que acreditaron correctamente;
- tasa de reclamación de pedidos invitados;
- tiempo entre pago y acreditación;
- errores o duplicados por webhook;
- cashback emitido, revertido y canjeado;
- conversión y recompra de miembros frente a invitados;
- ventas y comisiones de clientes Blue por IB.

Meta operativa inicial:

- más de 80% de pedidos identificados;
- más de 99.5% de pedidos elegibles acreditados sin intervención;
- cero duplicados;
- acreditación en menos de cinco minutos después del pago.

## Criterios de aceptación antes de anunciarlo

1. Silver, Blue y Golden ven su saldo tras iniciar sesión.
2. Un miembro Blue conserva el mismo IB en compras físicas y online.
3. Un pedido pagado con sesión acredita exactamente una vez.
4. Un pedido invitado puede reclamarse sólo después de OTP y sólo una vez.
5. Una devolución parcial ajusta cliente e IB en la proporción correcta.
6. Una cancelación total deja el efecto neto del pedido en cero.
7. Repetir cualquier webhook no cambia de nuevo el saldo.
8. El pedido, el ledger y el movimiento mostrado al cliente coinciden.
9. Un cliente no puede ver ni reclamar saldo de otra persona.
10. Si el servicio Nekudot falla, Shopify puede completar la compra y la cola
    recupera la acreditación sin cobrar dos veces.
11. QR, NFC y código de barras de una tarjeta identifican al mismo miembro.
12. Bloquear una credencial no elimina ni mueve el saldo del miembro.
13. Un registro duplicado sólo se vincula después de OTP o revisión autorizada.
14. La compra propia de un IB genera 5% personal y 5% IB en ledgers separados.
15. Una devolución de esa compra revierte ambos beneficios proporcionalmente.

## Recomendación de lanzamiento

Lanzar primero la Fase 1 con un grupo pequeño de clientes conocidos durante una
semana. Después abrirla a todos los miembros y habilitar la recuperación de
invitados. El mensaje público debe anunciar cashback online sólo cuando las diez
pruebas de aceptación hayan pasado en producción.

## Referencias técnicas de Shopify

- Customer account UI extensions:
  <https://shopify.dev/docs/api/customer-account-ui-extensions/latest>
- Desarrollo para cuentas de cliente:
  <https://shopify.dev/docs/apps/build/customer-accounts>
- Customer Account API:
  <https://shopify.dev/docs/api/customer-account-ui-extensions/latest/target-apis/account-apis/customer-account-api>
- Atributos de carrito que se trasladan al pedido:
  <https://shopify.dev/docs/api/storefront/latest/objects/attribute>
- Webhooks de aplicaciones:
  <https://shopify.dev/docs/apps/build/webhooks>
