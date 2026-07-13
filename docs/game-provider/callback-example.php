<?php
/******
 * REFERENCIA DEL PROVEEDOR — Callback API (Seamless) v100.
 * Copiado tal cual del panel (API → Callback API (Seamless) → Example Source).
 * NO se ejecuta acá: es la implementación canónica a replicar en NestJS.
 * Ver docs/game-provider/03-callback-seamless.md para el desglose.
 *
 * Notas de traducción a nuestra plataforma:
 *  - user_casino.money  -> wallet.balance del jugador (fichas)
 *  - bet_casino         -> tabla provider_bets (trans_guid PK, idempotencia)
 *  - CALLBACK_TOKEN     -> secreto GAME_PROVIDER_CALLBACK_TOKEN (no en git)
 *  - intval($amount)    -> NO truncar para ARS; operar en centavos (bigint)
 ******/

/***
 * Tablas usadas (esquema del ejemplo)
 *
 * CREATE TABLE `bet_casino` (
 *   `trans_guid` VARCHAR(64) NOT NULL,
 *   `user_id` VARCHAR(20) NOT NULL,
 *   `game_id` VARCHAR(100) NOT NULL DEFAULT '',
 *   `round_id` VARCHAR(64) NOT NULL DEFAULT '',
 *   `sort` ENUM('BET','WIN','CANCEL') NOT NULL,
 *   `money` INT(11) NOT NULL,
 *   `request_datetime` INT(11) NOT NULL DEFAULT '0',
 *   PRIMARY KEY (`trans_guid`),
 *   INDEX `game_id` (`game_id`, `round_id`)
 * );
 * CREATE TABLE `user_casino` (
 *   `user_id` VARCHAR(20) NOT NULL,
 *   `user_name` VARCHAR(20) NOT NULL,
 *   `user_nickname` VARCHAR(20) NOT NULL,
 *   `money` INT(11) NOT NULL DEFAULT '0',
 *   `token` VARCHAR(50) NOT NULL DEFAULT '',
 *   `status` ENUM('Active','Drop') NOT NULL DEFAULT 'Active',
 *   PRIMARY KEY (`user_id`),
 *   INDEX `token` (`token`)
 * );
 */

$servername = "127.0.0.1";
$username = "root";
$password = "";
$database = "casino";

$dbConn = new mysqli($servername, $username, $password, $database);
if ($dbConn->connect_error) {
    die("Connection failed: " . $dbConn->connect_error);
}

// CALLBACK_TOKEN (ejemplo del doc — el real va en Settings/secreto)
const CALLBACK_TOKEN = 'eadd5a04-4720-4a10-ae60-b11cd01cc3aa';

$headers = apache_request_headers();
$token_data = trim($headers['Callback-Token']);

// Verificación del callback token
if (CALLBACK_TOKEN != $token_data) {
    $result = [
        'result' => 100, // 100 si el callback token no coincide
        'status' => 'ERROR',
    ];
    echo json_encode($result);
    exit;
}

$requestData = file_get_contents('php://input');
$oData = json_decode($requestData);

$command = $oData->command;
$request_timestamp = $oData->request_timestamp; // En UTC

$aCheckItem = explode(',', $oData->check);

// ============ CHECKS (validaciones previas segun $oData->check) ============
$userInfo = '';
$betInfo = '';
foreach ($aCheckItem as $check) {
    switch ($check) {
        case 21:    // confirmacion de usuario
            $user_id = $oData->data->account;
            $sql = "SELECT * FROM user_casino WHERE user_id='{$user_id}'";
            $result = $dbConn->query($sql);
            if ($result->num_rows > 0) {
                $userInfo = $result->fetch_assoc();
            }
            if (!$userInfo) {
                $aResult = ['result' => $check, 'status' => 'ERROR'];
                $dbConn->close();
                echo json_encode($aResult);
                exit;
            }
            break;

        case 22:    // usuario activo?
            if ($userInfo['status'] != "Active") {
                $aResult = ['result' => $check, 'status' => 'ERROR'];
                $dbConn->close();
                echo json_encode($aResult);
                exit;
            }
            break;

        case 31: // balance del usuario >= amount
            $amount = intval($oData->data->amount); // KRW: intval ok. ARS: NO truncar.
            if ($userInfo['money'] < $amount) {
                $aResult = [
                    'result' => $check, 'status' => 'ERROR',
                    'data' => ['balance' => $userInfo['money']],
                ];
                $dbConn->close();
                echo json_encode($aResult);
                exit;
            }
            break;

        case 41:    // el trans_guid YA fue procesado? (idempotencia)
            $trans_guid = $oData->data->trans_guid;
            $sql = "SELECT * FROM bet_casino WHERE trans_guid='{$trans_guid}'";
            $result = $dbConn->query($sql);
            if ($result->num_rows > 0) {
                $aResult = [
                    'result' => $check, 'status' => 'ERROR',
                    'data' => ['balance' => $userInfo['money']],
                ];
                $dbConn->close();
                echo json_encode($aResult);
                exit;
            }
            break;

        case 42:   // el trans_guid existe? (para status)
            $trans_guid = $oData->data->trans_guid;
            $sql = "SELECT * FROM bet_casino WHERE trans_guid='{$trans_guid}'";
            $result = $dbConn->query($sql);
            if ($result->num_rows > 0) {
                $betInfo = $result->fetch_assoc();
            } else {
                $aResult = [
                    'result' => $check, 'status' => 'ERROR',
                    'data' => ['balance' => $userInfo['money']],
                ];
                $dbConn->close();
                echo json_encode($aResult);
                exit;
            }
            break;

        case 43:   // el cancel_trans_guid existe? (para cancel)
            $cancel_trans_guid = $oData->data->cancel_trans_guid;
            $sql = "SELECT * FROM bet_casino WHERE trans_guid='{$cancel_trans_guid}'";
            $result = $dbConn->query($sql);
            if ($result->num_rows > 0) {
                $betInfo = $result->fetch_assoc();
            } else {
                $aResult = [
                    'result' => $check, 'status' => 'ERROR',
                    'data' => ['balance' => $userInfo['money']],
                ];
                $dbConn->close();
                echo json_encode($aResult);
                exit;
            }
            break;
    }
}

// ============ PROCESAMIENTO (segun $command) ============
$aResult = [];
switch ($command) {
    case "authenticate":
        $aResult = [
            'result' => 0, 'status' => 'OK',
            'data' => [
                'account' => $userInfo['user_id'], // ID unico (string 4-15)
                'balance' => $userInfo['money'],
            ],
        ];
        break;

    case "balance":
        $aResult = [
            'result' => 0, 'status' => 'OK',
            'data' => ['balance' => $userInfo['money']],
        ];
        break;

    case "bet": // descuenta el balance
        $trans_guid = $oData->data->trans_guid;
        $trans_timestamp = $oData->timestamp;   // hora de la tx (UTC)
        $amount = intval($oData->data->amount);
        $game_id = $oData->data->game_code;
        $game_type = $oData->data->game_type;
        $round_id = $oData->data->round_id;

        $user_id = $userInfo['user_id'];
        $request_datetime = time();
        $sql = "INSERT INTO bet_casino VALUES ('{$trans_guid}', '{$user_id}', '{$game_id}', '{$round_id}', 'BET', '{$amount}', '{$request_datetime}')";
        $result = $dbConn->query($sql);
        if (!$result) {
            $aResult = ['result' => 99, 'status' => 'ERROR', 'data' => ['balance' => $userInfo['money']]];
            $dbConn->close();
            echo json_encode($aResult);
            exit;
        }

        $user_money = $userInfo['money'] - $amount;
        $sql = "UPDATE user_casino SET money='{$user_money}' WHERE user_id='{$user_id}'";
        $result = $dbConn->query($sql);

        $aResult = ['result' => 0, 'status' => 'OK', 'data' => ['balance' => $user_money]];
        break;

    case "win": // acredita hits (amount>0) o registra miss (amount=0)
        $trans_guid = $oData->data->trans_guid;
        $amount = intval($oData->data->amount);
        $game_id = $oData->data->game_code;
        $round_id = $oData->data->round_id;

        $user_id = $userInfo['user_id'];
        $request_datetime = time();
        $sql = "INSERT INTO bet_casino VALUES ('{$trans_guid}', '{$user_id}', '{$game_id}', '{$round_id}', 'WIN', '{$amount}', '{$request_datetime}')";
        $result = $dbConn->query($sql);

        $user_money = $userInfo['money'] + $amount;
        if ($result) {
            if ($amount > 0) {
                $sql = "UPDATE user_casino SET money='{$user_money}' WHERE user_id='{$user_id}'";
                $result = $dbConn->query($sql);
            }
        } else {
            $aResult = ['result' => 99, 'status' => 'ERROR', 'data' => ['balance' => $userInfo['money']]];
            $dbConn->close();
            echo json_encode($aResult);
            exit;
        }

        $aResult = ['result' => 0, 'status' => 'OK', 'data' => ['balance' => $user_money]];
        break;

    case "cancel": // revierte un BET (+) o un WIN (-)
        $money = 0;
        $user_id = $userInfo['user_id'];
        $user_money = $userInfo['money'];
        $cancel_trans_guid = $oData->data->cancel_trans_guid;

        if ($betInfo['sort'] != "CANCEL") { // solo si no está ya cancelado
            if ($betInfo['sort'] == "BET") {
                $money = $betInfo['money'];
                $sql = "UPDATE bet_casino SET sort='CANCEL' WHERE trans_guid='{$cancel_trans_guid}'";
                $result = $dbConn->query($sql);
                if ($result) {
                    $user_money = $userInfo['money'] + $money;
                    $sql = "UPDATE user_casino SET money='{$user_money}' WHERE user_id='{$user_id}'";
                    $result = $dbConn->query($sql);
                } else {
                    $aResult = ['result' => 99, 'status' => 'ERROR', 'data' => ['balance' => $userInfo['money']]];
                    $dbConn->close();
                    echo json_encode($aResult);
                    exit;
                }
            } else if ($betInfo['sort'] == "WIN") {
                $money = -1 * $betInfo['money'];
                $sql = "UPDATE bet_casino SET sort='CANCEL' WHERE trans_guid='{$cancel_trans_guid}'";
                $result = $dbConn->query($sql);
                if ($result) {
                    $user_money = $userInfo['money'] + $money;
                    $sql = "UPDATE user_casino SET money='{$user_money}' WHERE user_id='{$user_id}'";
                    $result = $dbConn->query($sql);
                } else {
                    $aResult = ['result' => 99, 'status' => 'ERROR', 'data' => ['balance' => $userInfo['money']]];
                    $dbConn->close();
                    echo json_encode($aResult);
                    exit;
                }
            }
        }

        $aResult = ['result' => 0, 'status' => 'OK', 'data' => ['balance' => $user_money]];
        break;

    case "status":
        $trans_guid = $oData->data->trans_guid;
        if ($betInfo['sort'] == "CANCEL") {
            $aResult = [
                'result' => 0, 'status' => 'OK',
                'data' => ['account' => $userInfo['user_id'], 'trans_guid' => $trans_guid, 'trans_status' => 'CANCELED'],
            ];
        } else {
            $aResult = [
                'result' => 0, 'status' => 'OK',
                'data' => ['account' => $userInfo['user_id'], 'trans_guid' => $trans_guid, 'trans_status' => 'OK'],
            ];
        }
        break;
}

$dbConn->close();
echo json_encode($aResult);
