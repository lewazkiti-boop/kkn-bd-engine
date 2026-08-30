<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed.']);
    exit;
}

// Keep your Resend API key server-side. On cPanel, either set an environment
// variable named RESEND_API_KEY or replace the placeholder below after upload.
$resendApiKey = getenv('RESEND_API_KEY') ?: 're_BcB7NLVj_L21HH2UZwhWgKtyPjcJRk3QB';
$toEmail = ['wiztyping@gmail.com', 'lewazkiti@gmail.com'];
$fromEmail = 'Bideey <no-reply@bideey.com>';

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

if ($resendApiKey === '' || $resendApiKey === 'PASTE_YOUR_RESEND_API_KEY_HERE') {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Email is not configured yet. Please add the Resend API key on the server.']);
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
$subject = 'New Bideey beta access request';

$html = '
  <h2>New Bideey beta access request</h2>
  <p><strong>Submitted:</strong> ' . escape_html($submittedAt) . '</p>
  <table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;">
    <tr><td><strong>Full name</strong></td><td>' . escape_html($fullName) . '</td></tr>
    <tr><td><strong>Work email</strong></td><td>' . escape_html($workEmail) . '</td></tr>
    <tr><td><strong>Firm / organisation</strong></td><td>' . escape_html($firmName) . '</td></tr>
    <tr><td><strong>Country</strong></td><td>' . escape_html($country) . '</td></tr>
    <tr><td><strong>Role</strong></td><td>' . escape_html($role) . '</td></tr>
    <tr><td><strong>Number of partners / BD users</strong></td><td>' . escape_html($teamSize) . '</td></tr>
    <tr><td><strong>Current tracking method</strong></td><td>' . escape_html($currentMethod ?: 'Not provided') . '</td></tr>
    <tr><td><strong>Biggest BD challenge</strong></td><td>' . nl2br(escape_html($challenge)) . '</td></tr>
    <tr><td><strong>Optional message</strong></td><td>' . nl2br(escape_html($message ?: 'Not provided')) . '</td></tr>
  </table>
';

$text = "New Bideey beta access request\n\n"
    . "Submitted: {$submittedAt}\n"
    . "Full name: {$fullName}\n"
    . "Work email: {$workEmail}\n"
    . "Firm / organisation: {$firmName}\n"
    . "Country: {$country}\n"
    . "Role: {$role}\n"
    . "Number of partners / BD users: {$teamSize}\n"
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

