<?php
/**
 * Plugin Name: REST API Basic Auth Fix
 * Plugin URI: https://github.com/tanukichiyamaguchi/dentalBlog
 * Description: XSERVER等のCGI/FastCGI環境でREST APIのBasic認証(Application Password)を有効にします。
 * Version: 2.0.0
 * Author: Sasaki Dental Blog Tools
 * License: GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * CGI/FastCGI環境ではAuthorizationヘッダーがPHPに渡されないため、
 * カスタムヘッダー X-WP-Authorization を使って認証情報を受け取る。
 */
add_action( 'init', function () {
    // 既に認証情報がセットされていれば何もしない
    if ( ! empty( $_SERVER['PHP_AUTH_USER'] ) ) {
        return;
    }

    $auth = '';

    // 方法1: カスタムヘッダー X-WP-Authorization（XSERVERが削除しない）
    if ( isset( $_SERVER['HTTP_X_WP_AUTHORIZATION'] ) && ! empty( $_SERVER['HTTP_X_WP_AUTHORIZATION'] ) ) {
        $auth = $_SERVER['HTTP_X_WP_AUTHORIZATION'];
    }
    // 方法2: CGI/FastCGIでリダイレクト経由で渡される場合
    elseif ( isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) && ! empty( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
        $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    // 方法3: 通常のHTTP_AUTHORIZATION
    elseif ( isset( $_SERVER['HTTP_AUTHORIZATION'] ) && ! empty( $_SERVER['HTTP_AUTHORIZATION'] ) ) {
        $auth = $_SERVER['HTTP_AUTHORIZATION'];
    }
    // 方法4: Apacheのrequest_headers関数が使える場合
    elseif ( function_exists( 'apache_request_headers' ) ) {
        $headers = apache_request_headers();
        if ( isset( $headers['X-WP-Authorization'] ) ) {
            $auth = $headers['X-WP-Authorization'];
        } elseif ( isset( $headers['Authorization'] ) ) {
            $auth = $headers['Authorization'];
        }
    }

    if ( $auth && stripos( $auth, 'Basic ' ) === 0 ) {
        $decoded = base64_decode( substr( $auth, 6 ) );
        if ( $decoded && strpos( $decoded, ':' ) !== false ) {
            list( $user, $pass ) = explode( ':', $decoded, 2 );
            $_SERVER['PHP_AUTH_USER'] = $user;
            $_SERVER['PHP_AUTH_PW']   = $pass;
        }
    }
}, 1 );

/**
 * プラグイン有効化時に .htaccess にAuthorizationヘッダー転送ルールを追加する。
 */
register_activation_hook( __FILE__, function () {
    $htaccess = ABSPATH . '.htaccess';
    if ( ! is_writable( $htaccess ) ) {
        return;
    }

    $content = file_get_contents( $htaccess );
    if ( strpos( $content, 'REST API Auth Fix' ) !== false ) {
        return;
    }

    $rule = "\n# BEGIN REST API Auth Fix\n"
          . "<IfModule mod_rewrite.c>\n"
          . "RewriteEngine On\n"
          . "RewriteCond %{HTTP:Authorization} ^(.*)\n"
          . "RewriteRule .* - [E=HTTP_AUTHORIZATION:%1]\n"
          . "</IfModule>\n"
          . "# END REST API Auth Fix\n\n";

    file_put_contents( $htaccess, $rule . $content );
} );

/**
 * プラグイン無効化時に .htaccess から追加したルールを削除する。
 */
register_deactivation_hook( __FILE__, function () {
    $htaccess = ABSPATH . '.htaccess';
    if ( ! is_writable( $htaccess ) ) {
        return;
    }

    $content = file_get_contents( $htaccess );
    $content = preg_replace(
        '/\n?# BEGIN REST API Auth Fix\n.*?# END REST API Auth Fix\n*/s',
        '',
        $content
    );
    file_put_contents( $htaccess, $content );
} );
