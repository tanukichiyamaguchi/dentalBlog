<?php
/**
 * Plugin Name: REST API Basic Auth Fix
 * Plugin URI: https://github.com/tanukichiyamaguchi/dentalBlog
 * Description: XSERVER等のCGI/FastCGI環境でREST APIのBasic認証(Application Password)を有効にします。
 * Version: 3.0.0
 * Author: Sasaki Dental Blog Tools
 * License: GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * 認証情報をクエリパラメータ・カスタムヘッダー・標準ヘッダーの
 * いずれかから取得し、PHP_AUTH_USER / PHP_AUTH_PW にセットする。
 *
 * determine_current_user フィルタの priority 15 で実行し、
 * WordPress標準の Application Password 認証（priority 20）より先に動く。
 */
add_filter( 'determine_current_user', function ( $user_id ) {
    // 既にログイン済みなら何もしない
    if ( $user_id ) {
        return $user_id;
    }

    // 既に PHP_AUTH_USER がセットされていれば何もしない
    if ( ! empty( $_SERVER['PHP_AUTH_USER'] ) ) {
        return $user_id;
    }

    $auth_base64 = '';

    // 方法1: クエリパラメータ _wp_auth（最も確実・XSERVERで削除されない）
    if ( isset( $_GET['_wp_auth'] ) && ! empty( $_GET['_wp_auth'] ) ) {
        $auth_base64 = $_GET['_wp_auth'];
    }
    // 方法2: POSTボディの _wp_auth
    elseif ( isset( $_POST['_wp_auth'] ) && ! empty( $_POST['_wp_auth'] ) ) {
        $auth_base64 = $_POST['_wp_auth'];
    }
    // 方法3: カスタムヘッダー X-WP-Authorization
    elseif ( isset( $_SERVER['HTTP_X_WP_AUTHORIZATION'] ) && ! empty( $_SERVER['HTTP_X_WP_AUTHORIZATION'] ) ) {
        $val = $_SERVER['HTTP_X_WP_AUTHORIZATION'];
        if ( stripos( $val, 'Basic ' ) === 0 ) {
            $auth_base64 = substr( $val, 6 );
        }
    }
    // 方法4: REDIRECT_HTTP_AUTHORIZATION（CGI/FastCGI経由）
    elseif ( isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) && ! empty( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
        $val = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        if ( stripos( $val, 'Basic ' ) === 0 ) {
            $auth_base64 = substr( $val, 6 );
        }
    }
    // 方法5: HTTP_AUTHORIZATION
    elseif ( isset( $_SERVER['HTTP_AUTHORIZATION'] ) && ! empty( $_SERVER['HTTP_AUTHORIZATION'] ) ) {
        $val = $_SERVER['HTTP_AUTHORIZATION'];
        if ( stripos( $val, 'Basic ' ) === 0 ) {
            $auth_base64 = substr( $val, 6 );
        }
    }
    // 方法6: apache_request_headers()
    elseif ( function_exists( 'apache_request_headers' ) ) {
        $headers = apache_request_headers();
        foreach ( array( 'X-WP-Authorization', 'Authorization' ) as $key ) {
            if ( isset( $headers[ $key ] ) && stripos( $headers[ $key ], 'Basic ' ) === 0 ) {
                $auth_base64 = substr( $headers[ $key ], 6 );
                break;
            }
        }
    }

    if ( empty( $auth_base64 ) ) {
        return $user_id;
    }

    $decoded = base64_decode( $auth_base64 );
    if ( ! $decoded || strpos( $decoded, ':' ) === false ) {
        return $user_id;
    }

    list( $username, $password ) = explode( ':', $decoded, 2 );
    $_SERVER['PHP_AUTH_USER'] = $username;
    $_SERVER['PHP_AUTH_PW']   = $password;

    return $user_id;
}, 15 );

/**
 * 診断用REST APIエンドポイント（認証不要）
 * プラグインが有効化されているか確認するために使用。
 */
add_action( 'rest_api_init', function () {
    register_rest_route( 'sasaki-dental/v1', '/status', array(
        'methods'             => 'GET',
        'callback'            => function () {
            return new WP_REST_Response( array(
                'plugin'     => 'rest-api-auth-fix',
                'version'    => '3.0.0',
                'active'     => true,
                'php_sapi'   => php_sapi_name(),
                'wp_version' => get_bloginfo( 'version' ),
            ), 200 );
        },
        'permission_callback' => '__return_true',
    ) );
} );

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
