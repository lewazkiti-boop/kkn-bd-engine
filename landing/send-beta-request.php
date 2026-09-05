<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed.']);
    exit;
}

// Keep secrets server-side. Do not paste the Resend API key into index.html,
// script.js, or any other browser-served file.
//
// Recommended cPanel setup:
// 1) Create this file OUTSIDE public_html:
//    /home/YOUR_CPANEL_USERNAME/bideey-resend-config.php
// 2) Put the real key and mail settings in that private file.
//
// This handler also supports cPanel environment variables if your hosting plan
// lets you set them:
// RESEND_API_KEY, BIDEEY_MAIL_TO, BIDEEY_MAIL_FROM, BIDEEY_RESEND_CONFIG_PATH.
$documentRoot = isset($_SERVER['DOCUMENT_ROOT']) ? (string)$_SERVER['DOCUMENT_ROOT'] : '';
$configuredPath = getenv('BIDEEY_RESEND_CONFIG_PATH');
$privateConfigCandidates = array_filter([
    is_string($configuredPath) && trim($configuredPath) !== '' ? trim($configuredPath) : null,
    dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'bideey-resend-config.php',
    $documentRoot !== '' ? dirname($documentRoot) . DIRECTORY_SEPARATOR . 'bideey-resend-config.php' : null,
    $documentRoot !== '' ? dirname($documentRoot, 2) . DIRECTORY_SEPARATOR . 'bideey-resend-config.php' : null,
]);

$privateConfigPath = '';
$privateConfig = [];
foreach ($privateConfigCandidates as $candidatePath) {
    if (is_readable($candidatePath)) {
        $privateConfigPath = $candidatePath;
        $loadedConfig = require $privateConfigPath;
        if (is_array($loadedConfig)) {
            $privateConfig = $loadedConfig;
        }
        break;
    }
}

if ($privateConfigPath === '') {
    error_log('Bideey Resend config not found. Checked: ' . implode(', ', $privateConfigCandidates));
}

function env_or_config(string $envName, array $config, string $configName, string $fallback = ''): string
{
    $envValue = getenv($envName);
    if (is_string($envValue) && trim($envValue) !== '') {
        return trim($envValue);
    }

    $configValue = $config[$configName] ?? '';
    return is_string($configValue) ? trim($configValue) : $fallback;
}

function email_list_from_setting(string $value): array
{
    $emails = array_filter(array_map('trim', explode(',', $value)));
    return array_values(array_filter($emails, static fn ($email) => filter_var($email, FILTER_VALIDATE_EMAIL)));
}

$resendApiKey = env_or_config('RESEND_API_KEY', $privateConfig, 'resend_api_key');
$toEmail = email_list_from_setting(env_or_config('BIDEEY_MAIL_TO', $privateConfig, 'to', 'wiztyping@gmail.com,lewazkiti@gmail.com'));
$fromEmail = env_or_config('BIDEEY_MAIL_FROM', $privateConfig, 'from', 'Bideey <no-reply@bideey.com>');

function field(string $name): string
{
    return trim((string)($_POST[$name] ?? ''));
}

function escape_html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Honeypot field. Real people never see this; many bots fill it.
if (field('website') !== '') {
    echo json_encode(['ok' => true]);
    exit;
}

$fullName = field('fullName');
$workEmail = field('workEmail');
$firmName = field('firmName');
$country = field('country');
$role = field('role');
$teamSize = field('teamSize');
$currentMethod = field('currentMethod');
$challenge = field('challenge');
$message = field('message');
$consent = isset($_POST['consent']);

if ($resendApiKey === '') {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Email is not configured yet. Please add the Resend API key on the server.']);
    exit;
}

if (count($toEmail) === 0) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Email recipients are not configured yet.']);
    exit;
}

if (
    $fullName === '' ||
    $workEmail === '' ||
    !filter_var($workEmail, FILTER_VALIDATE_EMAIL) ||
    $firmName === '' ||
    $country === '' ||
    $role === '' ||
    $teamSize === '' ||
    $challenge === '' ||
    !$consent
) {
    http_response_code(422);
    echo json_encode(['ok' => false, 'message' => 'Please complete all required fields.']);
    exit;
}

$submittedAt = gmdate('Y-m-d H:i:s') . ' UTC';
$subject = 'New Bideey product walkthrough request';

$html = '
  <h2>New Bideey product walkthrough request</h2>
  <p><strong>Submitted:</strong> ' . escape_html($submittedAt) . '</p>
  <table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;">
    <tr><td><strong>Full name</strong></td><td>' . escape_html($fullName) . '</td></tr>
    <tr><td><strong>Work email</strong></td><td>' . escape_html($workEmail) . '</td></tr>
    <tr><td><strong>Firm / organisation</strong></td><td>' . escape_html($firmName) . '</td></tr>
    <tr><td><strong>Country</strong></td><td>' . escape_html($country) . '</td></tr>
    <tr><td><strong>Role</strong></td><td>' . escape_html($role) . '</td></tr>
    <tr><td><strong>Number of partners / Office Admins</strong></td><td>' . escape_html($teamSize) . '</td></tr>
    <tr><td><strong>Current tracking method</strong></td><td>' . escape_html($currentMethod ?: 'Not provided') . '</td></tr>
    <tr><td><strong>Biggest BD challenge</strong></td><td>' . nl2br(escape_html($challenge)) . '</td></tr>
    <tr><td><strong>Optional message</strong></td><td>' . nl2br(escape_html($message ?: 'Not provided')) . '</td></tr>
  </table>
';

$text = "New Bideey product walkthrough request\n\n"
    . "Submitted: {$submittedAt}\n"
    . "Full name: {$fullName}\n"
    . "Work email: {$workEmail}\n"
    . "Firm / organisation: {$firmName}\n"
    . "Country: {$country}\n"
    . "Role: {$role}\n"
    . "Number of partners / Office Admins: {$teamSize}\n"
    . "Current tracking method: " . ($currentMethod ?: 'Not provided') . "\n"
    . "Biggest BD challenge: {$challenge}\n"
    . "Optional message: " . ($message ?: 'Not provided') . "\n";

$payload = [
    'from' => $fromEmail,
    'to' => $toEmail,
    'reply_to' => $workEmail,
    'subject' => $subject,
    'html' => $html,
    'text' => $text,
];

$ch = curl_init('https://api.resend.com/emails');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $resendApiKey,
        'Content-Type: application/json',
        'Idempotency-Key: bideey-walkthrough-' . bin2hex(random_bytes(16)),
    ],
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_TIMEOUT => 20,
]);

$responseBody = curl_exec($ch);
$curlError = curl_error($ch);
$statusCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($responseBody === false || $curlError !== '') {
    http_response_code(502);
    echo json_encode(['ok' => false, 'message' => 'Email service could not be reached. Please try again later.']);
    exit;
}

if ($statusCode < 200 || $statusCode >= 300) {
    http_response_code(502);
    echo json_encode(['ok' => false, 'message' => 'Email could not be sent. Please check the Resend sender/domain settings.']);
    exit;
}

echo json_encode(['ok' => true]);
